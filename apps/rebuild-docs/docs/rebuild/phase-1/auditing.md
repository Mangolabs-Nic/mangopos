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

## Audit log schema

```sql
CREATE TABLE audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
```

## Retention

| Period | Retention | Storage |
| --- | --- | --- |
| Last 90 days | Full detail | Hot storage (Postgres) |
| 90 days – 1 year | Summary only | Compressed archive |
| 1+ year | Aggregate stats only | Separate analytics store |

## Access control

| Role | Access |
| --- | --- |
| Admin | Full audit log access |
| Supervisor | Own actions + cashier actions under their supervision |
| Cashier | Own actions only |

## Implementation

- Audit triggers are implemented as Supabase database functions
- Frontend shows audit log in a dedicated "Activity" section
- Export capability for compliance (CSV/PDF)
- Real-time notifications for critical actions (void, stock adjustment)

## Compliance notes

- Nicaragua does not currently require electronic audit trails for POS systems
- Implementing audit logging now positions the product for future compliance requirements
- Audit data is never deleted — only archived according to retention policy
