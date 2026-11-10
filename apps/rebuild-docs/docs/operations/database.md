---
sidebar_position: 4
---

# Database schema

## Core entities

```mermaid
erDiagram
    BUSINESSES ||--o{ USERS : has
    USERS ||--o{ SALES : creates
    USERS ||--o{ EXPENSES : creates
    USERS ||--o{ AUDIT_LOG : generates
    USERS ||--o| EMPLOYEE_PINS : has
    BUSINESSES ||--o{ EMPLOYEE_PINS : owns
    BUSINESSES ||--o{ PIN_ATTEMPTS : records
    BUSINESSES ||--o{ PRODUCTS : has
    BUSINESSES ||--o{ CATEGORIES : has
    CATEGORIES ||--o{ PRODUCTS : contains
    PRODUCTS ||--o{ SALE_ITEMS : includes
    PRODUCTS ||--o{ STOCK_ADJUSTMENTS : has
    SALES ||--o{ SALE_ITEMS : contains
    SALES ||--o{ AUDIT_LOG : generates

    BUSINESSES {
        uuid id PK
        string name
        string slug
        string domain
        string currency
        string timezone
        timestamp created_at
    }

    USERS {
        uuid id PK
        uuid business_id FK
        string email
        string role
        boolean active
        timestamp created_at
    }

    PRODUCTS {
        uuid id PK
        uuid business_id FK
        uuid category_id FK
        string name
        string sku
        decimal price
        decimal cost
        integer stock
        integer low_stock_threshold
        boolean is_service
        boolean active
        timestamp created_at
    }

    CATEGORIES {
        uuid id PK
        uuid business_id FK
        string name
        string description
        timestamp created_at
    }

    SALES {
        uuid id PK
        uuid business_id FK
        uuid user_id FK
        decimal subtotal
        decimal tax
        decimal total
        string status
        string void_reason
        timestamp created_at
    }

    SALE_ITEMS {
        uuid id PK
        uuid business_id FK
        uuid sale_id FK
        uuid product_id FK
        integer quantity
        decimal unit_price
        decimal unit_cost
        decimal total
    }

    EXPENSES {
        uuid id PK
        uuid business_id FK
        uuid user_id FK
        string category
        decimal amount
        string description
        timestamp created_at
    }

    STOCK_ADJUSTMENTS {
        uuid id PK
        uuid product_id FK
        uuid user_id FK
        integer quantity_before
        integer adjustment
        integer quantity_after
        string reason
        timestamp created_at
    }

    AUDIT_LOG {
        uuid id PK
        uuid business_id
        uuid user_id
        string action
        string entity_type
        uuid entity_id
        jsonb old_values
        jsonb new_values
        jsonb metadata
        timestamp created_at
    }

    EMPLOYEE_PINS {
        uuid id PK
        uuid user_id FK
        uuid business_id FK
        string pin_lookup
        timestamp updated_at
    }

    PIN_ATTEMPTS {
        uuid id PK
        uuid business_id FK
        string ip_hash
        boolean succeeded
        timestamp attempted_at
    }
```

`audit_log` is the one table that carries a tenant **without** a foreign key to it, and
carries the actor without a foreign key to `profiles`. Both are deliberate — see
[Audit log](#audit-log).

## Multi-tenant isolation

Every tenant-owned table includes a `business_id` foreign key, and Row-Level Security
filters queries by the authenticated user's business. `sale_items` carries it too
(since migration 003); `stock_adjustments` deliberately omits it and resolves tenancy
through its parent `products`, so a tenant key can never drift between rows.

### Do not read `business_id` from the JWT

```sql
-- WRONG. Supabase does not put business_id in the JWT unless you build a
-- custom access-token hook. Without one this matches zero rows and every
-- query returns nothing, with no error.
CREATE POLICY products_own ON products
    FOR ALL USING (business_id = auth.jwt() ->> 'business_id');
```

Resolve the tenant through a `SECURITY DEFINER` function instead. `SECURITY DEFINER`
is required, not stylistic: `profiles` has its own RLS, so a policy on `profiles` that
queries `profiles` would recurse infinitely.

```sql
-- CORRECT — this is what migration 001 ships.
CREATE FUNCTION public.current_business_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT business_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE POLICY products_own ON public.products
    FOR ALL USING (business_id = public.current_business_id());
```

The same applies to trigger functions that write to a protected table. A
`SECURITY INVOKER` trigger is evaluated against the calling user's RLS policies, so a
trigger that inserts into a table whose `INSERT` policy is closed will have its own
write rejected. `audit_row_change()` is `SECURITY DEFINER` for that reason.

## Roles

A profile carries one of three roles. The legacy POS had no roles at all — only nine
module flags, set per employee and enforced in the UI — so this matrix is new, and the
database is the only thing enforcing it.

| | cashier | supervisor | admin |
|---|---|---|---|
| take a sale, record an expense | yes | yes | yes |
| record a stock adjustment | yes | yes | yes |
| create or edit products, categories, payment methods, customers | no | yes | yes |
| change a price or a cost | no | yes | yes |
| correct an expense | no | yes | yes |
| void a sale (reason required) | no | yes | yes |
| delete a product, expense, category, payment method or customer | no | no | yes |
| set another member's role | no | no | yes |
| rename the business | no | no | yes |
| edit a completed sale or one of its lines | no | no | no |
| delete a sale, a stock adjustment, or an audit row | no | no | no |
| read the audit log | own entries | own + their cashiers | the whole trail |
| close the business | server only | server only | server only |

Four rules carry most of it:

- **A completed sale is a fact.** It is written once, and afterwards the only permitted
  change is the void, which needs a reason. Nobody edits a total or a line quantity.
- **Stock is corrected by adding a row, never by removing one.** `stock_adjustments` has
  no `DELETE` grant at all, and its `reason` is `NOT NULL`.
- **Price and cost are `supervisor` and up.** Row-level security cannot see columns, so
  `guard_product_pricing()` enforces this.
- **Nobody changes their own role**, not even an admin. That is the legacy self-escalation
  — anyone who could edit an employee could tick every permission box on their own record.

Two enforcement details worth knowing before you write a trigger:

- A refused `UPDATE` or `DELETE` is **filtered, not refused**: the statement succeeds and
  affects zero rows, raising nothing. Only a failed `INSERT` trips the `WITH CHECK`. Tests
  have to assert on `ROW_COUNT` or they will read a denial as a success.
- The role-checking triggers are `SECURITY INVOKER` on purpose. Inside a `SECURITY DEFINER`
  function `current_user` is the function owner, so a definer trigger cannot tell a client
  from the server. `service_role` and a direct `DATABASE_URL` connection bypass
  row-level security anyway, so the matrix is enforced at the client edge and the server
  is trusted — a rebuild or an import may correct rows in place.

## Employee authentication

Identity lives in Supabase Auth (`auth.users`); `profiles` is the app-side companion.
Three pieces make the legacy employee PIN work without putting a password in a table.

### The login handle

`businesses.slug` is unique and stable (`mi-tienda-3f9a1c2b`, derived from the name plus
a random suffix). A four-digit PIN cannot be unique across the whole platform, so the
login form resolves the PIN **inside** a business. The slug is a handle, not a secret.

### The PIN blind index

`employee_pins.pin_lookup` is `HMAC-SHA256(pin, PIN_PEPPER)`, unique per business. The PIN
itself is never stored. The pepper lives in the API, so a database dump alone does not
let anyone enumerate the (small) PIN space; the digest is also never selectable by any
client role.

| Column | Meaning |
| --- | --- |
| `user_id` | The employee; one PIN per profile |
| `business_id` | Derived from the profile by `set_employee_pin()` |
| `pin_lookup` | The blind index; unique per business |
| `updated_at` | When the PIN last changed |

`public.set_employee_pin(user_id, digest)` is the only writer, `SECURITY DEFINER` and
`service_role` only. A duplicate digest inside a business is a unique violation, which the
API reports as `409` rather than silently letting one employee shadow another.

A PIN change writes an audit entry (`profiles.pin_changed`) with no values at all — the
event is evidence, the digest is not.

### The attempt ledger

`pin_attempts` records one row per attempt (business, hashed address, success). Ten
failures from the same address in fifteen minutes lock the next attempt for the rest of
the window; a success clears that address's failures. The address is stored as
`HMAC-SHA256(ip, PIN_PEPPER)`, because the limit only needs to recognise the caller.

`public.employee_pin_login(slug, digest, address_hash)` returns `ok` with the account's
email, `invalid` for every kind of miss (no business, no PIN, inactive employee), or
`locked` with `retry_after_seconds`. Only `service_role` may execute it.

### The claims hook

`public.custom_access_token_hook(event)` adds `user_id`, `business_id`, `app_role` and
`active` to every access token. It is granted to `supabase_auth_admin` and nobody else.
Tenancy in RLS still comes from `profiles` through `current_business_id()` and
`current_role()` — those read the live row, so **deactivation stops RLS-backed data access
on the next request** instead of waiting for a token refresh. The claims exist for the API
guard and for clients that need to address a tenant without a round trip; an already-issued
token keeps its `active` claim until it is refreshed.

| Surface | Reads tenancy from | Freshness |
| --- | --- | --- |
| RLS policies | `profiles` via `current_business_id()` | Live |
| API guard | JWT claims | Token lifetime (1 h default) |

Enable the hook outside SQL: locally in `supabase/config.toml`
(`[auth.hook.custom_access_token]`), hosted in Dashboard → Authentication → Hooks.
A token without those claims is refused by the API, so the hook is required.

## Reporting

Reports are SQL aggregates, not API-side loops. Migration `20261013000000` ships four
functions that the API calls through PostgREST **with the caller's JWT**. They are
`SECURITY INVOKER`, so `current_business_id()` and the RLS policies still decide which
rows a role may see; the API only adds the role gate (`admin` and `supervisor`).

| Function | Returns |
| --- | --- |
| `report_sales_summary(business, from, to, granularity)` | Totals per local day/week/month. Voided sales are counted but never summed |
| `report_inventory_valuation(business)` | `stock × cost` and `stock × price` for active products; services excluded |
| `report_expense_breakdown(business, from, to)` | Expense totals grouped by category |
| `report_profit(business, from, to)` | Revenue − snapshot COGS − expenses |

Two columns exist because of these queries:

- `sale_items.unit_cost` — the product cost at the moment the line was written, set by
  `sale_items_snapshot_cost()`. Without the snapshot, editing a product cost today would
  rewrite last month's profit. Existing rows were backfilled with the cost available at
  migration time; new rows are exact.
- `businesses.timezone` — IANA zone (default `America/Managua`). It turns an inclusive
  local date range into `[start, end)` and decides where a day, week or month begins.

Only sales whose `sales.currency` matches `businesses.currency` are included. The schema
has no exchange-rate table, so mixing currencies would silently add them at par.

Indexes `idx_sales_completed_date` and `idx_sale_items_business_product` cover the two
access patterns. Functions are executable by `authenticated` and `service_role`, never by
`anon`.

## Audit log

`audit_log` is append-only, and the database is what enforces it: `audit_log_immutable`
refuses `UPDATE` and `DELETE` row by row, `audit_log_no_truncate` refuses `TRUNCATE`, and
the grants are narrowed to `SELECT` for `authenticated` and `service_role`. It holds for
the owner and for the service key too — a trail the server can edit is not a trail.
Migration `20261010000000` is what makes it so.

### Every sensitive table is covered

An `AFTER INSERT OR UPDATE OR DELETE` trigger calls `audit_row_change()` on each of:

`businesses`, `profiles`, `categories`, `payment_methods`, `products`, `customers`,
`sales`, `sale_items`, `expenses`, `stock_adjustments`

The tenant comes off the row itself, never from `current_business_id()`, because that is
`NULL` whenever the write is made with the service key — the entry would be attributed to
nobody and become invisible to every tenant. `stock_adjustments` carries no `business_id`,
so it is resolved through `products`; `sale_items` gained one in migration 003.

### What an entry records

| Field | Meaning |
| --- | --- |
| `action` | The operation, named: `products.insert`, `sales.void`, `stock.adjust` |
| `old_values`, `new_values` | The row before and after, filtered by `audit_safe_values()` |
| `metadata.source` | `db_trigger` — the trigger is the only writer |
| `metadata.operation` | The raw `TG_OP`, which `action` is derived from |
| `metadata.actor_type` | `user`, or `system` when there is no JWT and no actor |
| `metadata.sensitive` | True for a `DELETE`, a `sales.void` or a `stock.adjust` |

### No secrets, by allowlist

`audit_safe_values()` copies an explicit list of scalar columns and drops everything else:
an unknown column, a nested object and an array are excluded by default. That direction
matters — a denylist has to name the secret before it exists, and the trail is the one
table from which nothing can ever be deleted. `audit_row_change()` is `SECURITY DEFINER`
because the trigger writes to a table whose `INSERT` is closed to every role;
`audit_safe_values()` is the plain immutable helper it calls.

### Evidence outlives what it describes

`audit_log` has **no** foreign keys. The original `ON DELETE CASCADE` from `businesses` and
`ON DELETE SET NULL` from `profiles` meant closing a tenant, or merely removing one person,
rewrote or erased the record of what they did. Both were dropped, so an entry survives its
tenant and keeps the actor it names. This is why closing a business purges its catalogue and
ledger but keeps the trail, and it is asserted in `scripts/verify-schema.sql`.

### Who reads it

| Role | Access |
| --- | --- |
| Admin | The whole trail of their own business |
| Supervisor | Their own actions, plus those of the cashiers in the business |
| Cashier | Only entries where they are the actor |

`audit_log_scoped` enforces this, and also requires an active profile. Full access is still
bounded by the tenant: no admin reads another business's log. An entry with no
`business_id` — a failed login for an address that never authenticated, for example —
belongs to no tenant and is visible only to the server, not to a business admin.

### API-origin entries

Some events change no row: a login, a logout, a backup, a sensitive request that was refused
before it touched anything. The API appends those through `audit_append()` rather than
through an `INSERT` grant. That matters because a grant is a writer that can forge any entry
it likes, while the function keeps the same rules as the trigger: `audit_safe_values()` on
the values, its own metadata allowlist, `source` and `actor_type` derived rather than
supplied, and `sensitive` forced on for a void, an adjustment or a delete.

Functions are executable by `PUBLIC` by default, so the migration revokes `EXECUTE` from
`anon` and `authenticated` and grants it to `service_role` alone. A browser cannot forge
the record of what its user did.

| Column | Value the API writes |
| --- | --- |
| `metadata.source` | `api` — no caller can claim `db_trigger` |
| `metadata.actor_type` | `user` when `user_id` is set, `system` otherwise |
| `metadata.request_id` | Correlates with the `http_request` line in the log bundle |
| `metadata.outcome` | `success`, `denied` or `error` |
| `metadata.sensitive` | Raised by the operation; a caller can add it but not remove it |

## Indexes

| Table | Index | Purpose |
| --- | --- | --- |
| `users` | `idx_users_business` | Multi-tenant filtering |
| `products` | `idx_products_business` | Multi-tenant filtering |
| `products` | `idx_products_category` | Category lookups |
| `sales` | `idx_sales_business_date` | Date-range queries |
| `sales` | `idx_sales_user` | User-specific queries |
| `audit_log` | `idx_audit_log_user` | Entries by actor |
| `audit_log` | `idx_audit_entity` | Entity audit trail |
| `audit_log` | `idx_audit_business_created` | A tenant's trail, time-based |
| `audit_log` | `idx_audit_cursor` | Keyset pagination, newest first |
