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
        string domain
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
        integer stock
        integer low_stock_threshold
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
        uuid sale_id FK
        uuid product_id FK
        integer quantity
        decimal unit_price
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
        uuid user_id FK
        string action
        string entity_type
        uuid entity_id
        jsonb old_values
        jsonb new_values
        timestamp created_at
    }
```

## Multi-tenant isolation

Every tenant-owned table includes a `business_id` foreign key, and Row-Level Security
filters queries by the authenticated user's business. Join tables (`sale_items`,
`stock_adjustments`) deliberately omit it and resolve tenancy through their parent, so
a tenant key can never drift between rows.

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

## Audit triggers

Every sensitive operation triggers an audit log entry:

```sql
-- Example audit trigger
CREATE OR REPLACE FUNCTION audit_sale_changes()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values)
    VALUES (
        auth.uid(),
        TG_OP,
        'sale',
        NEW.id,
        CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
        to_jsonb(NEW)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

## Indexes

| Table | Index | Purpose |
| --- | --- | --- |
| `users` | `idx_users_business` | Multi-tenant filtering |
| `products` | `idx_products_business` | Multi-tenant filtering |
| `products` | `idx_products_category` | Category lookups |
| `sales` | `idx_sales_business_date` | Date-range queries |
| `sales` | `idx_sales_user` | User-specific queries |
| `audit_log` | `idx_audit_user` | User audit trail |
| `audit_log` | `idx_audit_entity` | Entity audit trail |
| `audit_log` | `idx_audit_created` | Time-based queries |
