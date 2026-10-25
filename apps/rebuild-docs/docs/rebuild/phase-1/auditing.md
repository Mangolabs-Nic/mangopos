---
sidebar_position: 5
---

# Audit logging

## Purpose

Every sensitive action must be traceable to a user, timestamp, and reason. This is a non-negotiable rule from the roadmap.

## What gets audited

### Always audit (no exceptions)

| Action | Details logged |
| --- | --- |
| Sale created | User, items, total, timestamp |
| Sale voided | User, reason, original sale data |
| Sale edited | User, fields changed, before/after values |
| User created | Creator, new user details |
| User deactivated | Creator, target user |
| Role changed | Admin, target user, old role, new role |
| Product created/edited/deleted | User, product changes |
| Stock adjusted | User, product, adjustment amount, reason |
| Expense created/deleted | User, expense details |
| Login/logout | User, timestamp, IP (if available) |
| Backup triggered | User, backup type, status |

### Never audit

- Passwords or authentication tokens
- Session data
- Read-only operations (viewing reports, listing products)

The first two are enforced, not just intended: `audit_safe_values()` copies an explicit list
of scalar columns into `old_values` / `new_values` and drops everything else, so a column or
a nested payload that nobody thought about is excluded by default. See
[Never a secret](#never-a-secret).

:::note Where each entry comes from
A row change is recorded by a database trigger. **Login, logout and backup** change no
row, so the API writes them through `audit_append()`. The same interceptor adds the
request context to a void, a stock adjustment and a delete. See
[Implementation](#implementation).
:::

## Audit log schema

The shipped table is `public.audit_log`, created by migration `20261010000000`. It is
append-only: `audit_log_immutable` refuses `UPDATE` and `DELETE`, `audit_log_no_truncate`
refuses `TRUNCATE`, and no role holds a write grant.

```sql
CREATE TABLE public.audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid,                     -- no FK: see "Evidence outlives its tenant"
  user_id     uuid,                     -- the actor; NULL when the server wrote the row
  action      text NOT NULL,            -- products.insert, sales.void, stock.adjust
  entity_type text NOT NULL,
  entity_id   uuid,
  old_values  jsonb,                    -- filtered by audit_safe_values()
  new_values  jsonb,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- source, operation, actor_type, sensitive
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_user            ON public.audit_log (user_id);
CREATE INDEX idx_audit_entity              ON public.audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_business_created    ON public.audit_log (business_id, created_at DESC);
CREATE INDEX idx_audit_cursor              ON public.audit_log (business_id, created_at DESC, id DESC);
```

The API does not hold an `INSERT` grant. It appends through `audit_append()`, a
`SECURITY DEFINER` function granted to `service_role` alone; it applies the same value
allowlist and derives `source` and `actor_type` rather than trusting the caller.

### Never a secret

Values are filtered by an explicit **allowlist** (`audit_safe_values()`): a known scalar
column is copied, anything else — an unknown column, a nested object, an array — is dropped.
A denylist would have to name a secret before it exists, and this is the one table from which
nothing can ever be deleted.

### Sensitive operations

`action` names the operation rather than the SQL verb, and `metadata.sensitive` marks the
three the plan calls out. A stock adjustment carries its `reason` (the column is `NOT NULL`);
a void carries `void_reason`, which the sale check constraint already requires.

| Operation | `action` | `metadata.sensitive` |
| --- | --- | --- |
| Void a sale | `sales.void` | yes |
| Record a stock adjustment | `stock.adjust` | yes |
| Delete any covered row | `<table>.delete` | yes |
| Anything else | `<table>.<insert\|update>` | no |

### Evidence outlives its tenant

`audit_log` holds **no foreign keys**. The original cascade from `businesses` and the
`SET NULL` from `profiles` meant closing a tenant, or removing one person, rewrote or erased
the record of what they did. Both were dropped, so an entry survives the business it names
and keeps the actor. Closing a business therefore purges its catalogue and ledger and keeps
its trail.

## Retention

| Period | Retention | Storage |
| --- | --- | --- |
| Last 90 days | Full detail | Hot storage (Postgres) |
| 90 days – 1 year | Summary only | Compressed archive |
| 1+ year | Aggregate stats only | Separate analytics store |

Retention is the one thing here that is **not** implemented. Nothing archives or compresses
yet, and it cannot be done by deleting: the append-only triggers refuse `DELETE` and
`TRUNCATE` from every role. Archiving has to move rows out through a mechanism that is
designed for it, and the policy should be agreed before any data reaches a year old.

## Access control

| Role | Access |
| --- | --- |
| Admin | The whole trail of their own business |
| Supervisor | Own actions + cashier actions under their supervision |
| Cashier | Own actions only |

Shipped as the `audit_log_scoped` policy. It also requires an active profile, and it stays
tenant-scoped: an admin sees everything inside their business and nothing outside it.

## Implementation

Two writers, one table. The split is deliberate: the trigger knows what changed, the
interceptor knows who asked.

| Writer | Records |
| --- | --- |
| `audit_row_change()` — DB trigger | Every `INSERT`, `UPDATE` and `DELETE` on the ten sensitive tables, with allowlisted before/after values |
| `AuditInterceptor` — NestJS | `auth.login`, `auth.logout`, `backup.create`, and the request context of a void, a stock adjustment or a delete |

The interceptor does **not** duplicate routine writes. A `POST /products` changes a row,
so the trigger already records it; a second entry for the same change would be noise.
What the interceptor adds is what a row cannot hold: the caller, the address, the request
id, the duration, whether it was refused, and the reason a sensitive operation carried.

Shipped:

- Append-only enforcement (`audit_log_immutable`, `audit_log_no_truncate`) and no write
  grants for any role
- An audit trigger on all ten sensitive tables, through `audit_row_change()`
- An allowlist filter (`audit_safe_values()`) so no secret can be recorded
- `action` naming the operation, and `metadata.sensitive` marking the three the plan calls
  out
- `audit_log_scoped`, so the trail is read by role rather than by membership
- `audit_append()`, the only function the API may use to append, `service_role` only;
  it re-applies the value allowlist and forces `source = 'api'` and the sensitive flag
- `AuditInterceptor`, the policy that selects the sensitive and non-row events, and the
  request context it records
- `SupabaseAuditWriter` over the `audit_append` RPC, with `LogAuditWriter` as the
  credential-less fallback so an entry is never silently dropped

A failed append **never fails the business request**. A database that refuses the audit
write must not also refuse the sale — a lost sale is worse than a late entry. The failure
is written at `error` as `audit_write_failed` with the already-redacted entry, so
`/diagnostics/logs` keeps the evidence and the outage is visible.

Not done yet:

- **Reading the trail over HTTP.** Admin full access is enforced by `audit_log_scoped`,
  which is the rule that matters. There is no API route yet because the API has no
  authenticated principal: until an auth layer populates `request.user`, an endpoint would
  answer 401 to everyone.
- **Frontend "Activity" section, CSV/PDF export, real-time notifications for critical
  actions.** The data is there (`metadata.sensitive`, `idx_audit_cursor`); the surface is not.

## Compliance notes

- Nicaragua does not currently require electronic audit trails for POS systems
- Implementing audit logging now positions the product for future compliance requirements
- Audit data is never deleted — only archived according to retention policy. The evidence
  also outlives the tenant it describes, which is what dropping the foreign keys buys.
