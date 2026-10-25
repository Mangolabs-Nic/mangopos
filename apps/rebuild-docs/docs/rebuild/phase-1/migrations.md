---
sidebar_position: 4
---

# Database migrations

## Strategy

Migrations follow a **versioned, reversible** approach using Supabase's migration system.

## Migration principles

1. **Every schema change is a migration file** — never modify production directly
2. **Migrations are idempotent** — safe to re-run without side effects
3. **Migrations are reversible** — every `up` has a corresponding `down`
4. **Migrations are versioned** — timestamp-based ordering
5. **Migrations are tested** — run against a fresh database before production

## File structure

```
supabase/
├── migrations/
│   ├── 20260825000000_initial_schema.sql
│   ├── 20260826000000_add_user_roles.sql
│   └── ...
└── config.toml
```

## Migration workflow

### Development

```bash
# Create a new migration
supabase migration new add_user_roles

# Apply locally
supabase db reset

# Test against local database
npm run test:integration
```

### Production

```bash
# Push migrations to production
supabase db push

# Or apply specific migration
supabase migration up --db-url $PRODUCTION_DATABASE_URL
```

## Schema versioning

| Version | Description | Status |
| --- | --- | --- |
| 001 | Initial schema (inherited from PoopPOS) | ✅ Applied |
| 002 | User roles and permissions | ✅ Applied — `20260925000600_role_matrix.sql` |
| 003 | Multi-tenant isolation | ✅ Applied — `20260925000200_tenant_isolation_and_stock.sql` |
| 004 | Audit logging | ✅ Applied — `20261010000000_audit_log.sql` |
| 004b | API-origin audit writes | ✅ Applied — `20261011000000_audit_api_write.sql` |
| 005 | Inventory improvements | 🔲 Pending |

The plan numbers are not the file names: migrations are timestamped, and the audit work
landed as `20261010000000_audit_log.sql` rather than at the position this table predicted.

## Rollback procedure

```bash
# Rollback last migration
supabase migration down

# Rollback to specific version
supabase migration down --to 20260825000000

# Reset entire database (development only)
supabase db reset
```

## Data migration (Phase 0 deliverable)

:::caution Pending audit
The data migration plan will be defined after the technical audit of the desktop POS source. This section will be updated with:
- Source schema mapping
- Transformation rules
- Validation checks
- Rollback strategy for data migration
:::
