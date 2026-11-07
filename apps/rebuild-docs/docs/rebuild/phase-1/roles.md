---
sidebar_position: 3
---

# Roles and permissions

## Role hierarchy

```
Admin
  └── Supervisor
        └── Cashier
```

## Role definitions

### Admin

Full access to all system functions.

| Permission | Access |
| --- | --- |
| Manage users | Create, edit, delete, deactivate |
| Manage roles | Assign and modify roles |
| View all sales | All cashiers, all dates |
| Manage inventory | Full CRUD on products, categories, stock |
| Manage expenses | Create, edit, delete expense records |
| View reports | All reports, all date ranges |
| System settings | Business info, tax config, receipt templates |
| Audit log | View complete audit trail |
| Backup management | Trigger backups, view backup status |

### Supervisor

Operational management without system configuration.

| Permission | Access |
| --- | --- |
| Manage users | View only (no create/delete) |
| View all sales | All cashiers, all dates |
| Manage inventory | Full CRUD on products, categories, stock |
| Manage expenses | Create, edit (no delete) |
| View reports | All reports, all date ranges |
| System settings | View only |
| Audit log | View own actions + cashier actions |

### Cashier

Daily operations only.

| Permission | Access |
| --- | --- |
| Process sales | Create sales, apply discounts, void (with reason) |
| View own sales | Own transactions only |
| Manage inventory | View stock levels only |
| Create expenses | With description and category |
| View reports | Own daily summary only |

## Permission matrix

| Action | Admin | Supervisor | Cashier |
| --- | --- | --- | --- |
| Process sale | ✅ | ✅ | ✅ |
| Void sale | ✅ | ✅ | ✅ (with reason) |
| View all sales | ✅ | ✅ | ❌ (own only) |
| Create product | ✅ | ✅ | ❌ |
| Edit product | ✅ | ✅ | ❌ |
| Delete product | ✅ | ❌ | ❌ |
| Adjust stock | ✅ | ✅ | ❌ |
| Create expense | ✅ | ✅ | ✅ |
| Delete expense | ✅ | ❌ | ❌ |
| View reports | ✅ | ✅ | ❌ (daily only) |
| Manage users | ✅ | ❌ | ❌ |
| System settings | ✅ | ❌ | ❌ |
| Audit log | ✅ | ✅ (limited) | ❌ |

## Implementation notes

- Roles are enforced via Supabase Row-Level Security (RLS) policies
- Each user is associated with a business (multi-tenant isolation)
- Session timeout: 8 hours for cashier, 24 hours for admin/supervisor
- Password policy: minimum 8 characters, no complexity requirements initially

## Sessions and claims

Authentication happens in Supabase Auth. Every access token carries `user_id`,
`business_id`, `app_role` and `active`, added by the `custom_access_token_hook`; the API
guard authorises from those claims and RLS authorises from the live `profiles` row.

| Event | Takes effect |
| --- | --- |
| Role change | On the next token refresh (the role travels in the token) |
| Deactivation | RLS-backed data access stops immediately (`current_business_id()` / `current_role()` require `active`); the API guard sees the `active` claim change at the next refresh |
| Password / PIN change | Immediately for the changed credential; other sessions are unaffected |

An employee logs in with email and password, or with a business slug and PIN. The PIN is
only a lookup into Supabase Auth — it is never the account password, never stored in
clear, and never written to the audit trail. Password recovery is Supabase's built-in
email flow, so the security-question table from the desktop app is gone.

Session length is the Supabase `jwt_expiry` (one hour by default, refreshed
automatically). The 8/24-hour distinction above is a policy target, not something the
current token configuration implements.
