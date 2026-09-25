-- 001: initial schema
--
-- Source: mockdb.db (legacy Godot POS, SQLite, 37 tables) -> PoopPOS MVP subset.
-- Target spec: docs/operations/database.md, corrected where noted below.
--
-- Deliberate deviations from database.md:
--   1. `users` -> `profiles`. auth.users is managed by Supabase; you cannot add
--      business_id / role columns to it. A companion table is the supported pattern.
--   2. RLS does NOT read business_id from auth.jwt(). That claim only exists if you
--      build a custom access-token hook; without one every policy matches zero rows.
--      See public.current_business_id() below.
--   3. Money is numeric(12,2). Legacy used REAL (float) on every monetary column.
--   4. CHECK (stock >= 0). The legacy DB had no constraints at all; the plan requires
--      "no permitir stock negativo salvo autorizacion explicita".

-- =============================================================================
-- Tenancy
-- =============================================================================

CREATE TABLE public.businesses (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    domain     text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
    id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    email      text NOT NULL,
    role       text NOT NULL DEFAULT 'cashier'
                 CHECK (role IN ('admin', 'supervisor', 'cashier')),
    active     boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Catalog
-- =============================================================================

CREATE TABLE public.categories (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name        text NOT NULL,
    description text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.products (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    category_id        uuid REFERENCES public.categories(id) ON DELETE SET NULL,
    name               text NOT NULL,
    sku                text,
    barcode            text,
    price              numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    cost               numeric(12,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
    stock              integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
    low_stock_threshold integer NOT NULL DEFAULT 5,
    is_service         boolean NOT NULL DEFAULT false,
    active             boolean NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (business_id, sku)
);

-- =============================================================================
-- Sales
-- =============================================================================

CREATE TABLE public.sales (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    subtotal    numeric(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    tax         numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
    total       numeric(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    status      text NOT NULL DEFAULT 'completed'
                  CHECK (status IN ('completed', 'voided')),
    void_reason text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- A voided sale must carry a reason. The plan forbids silent deletion.
    CONSTRAINT void_requires_reason
        CHECK (status <> 'voided' OR (void_reason IS NOT NULL AND void_reason <> ''))
);

CREATE TABLE public.sale_items (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id      uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity     integer NOT NULL CHECK (quantity > 0),
    unit_price   numeric(12,2) NOT NULL CHECK (unit_price >= 0),
    total        numeric(12,2) NOT NULL CHECK (total >= 0)
);

-- =============================================================================
-- Expenses and inventory
-- =============================================================================

CREATE TABLE public.expenses (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    category    text,
    amount      numeric(12,2) NOT NULL CHECK (amount >= 0),
    description text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.stock_adjustments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    quantity_before integer NOT NULL,
    adjustment      integer NOT NULL,
    quantity_after  integer NOT NULL,
    reason          text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT adjustment_is_consistent CHECK (quantity_after = quantity_before + adjustment)
);

CREATE TABLE public.audit_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    action      text NOT NULL,
    entity_type text NOT NULL,
    entity_id   uuid,
    old_values  jsonb,
    new_values  jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Indexes (the legacy database had zero)
-- =============================================================================

CREATE INDEX idx_profiles_business      ON public.profiles (business_id);
CREATE INDEX idx_categories_business    ON public.categories (business_id);
CREATE INDEX idx_products_business      ON public.products (business_id);
CREATE INDEX idx_products_category      ON public.products (category_id);
CREATE INDEX idx_sales_business_date    ON public.sales (business_id, created_at DESC);
CREATE INDEX idx_sales_user             ON public.sales (user_id);
CREATE INDEX idx_sale_items_sale        ON public.sale_items (sale_id);
CREATE INDEX idx_sale_items_product     ON public.sale_items (product_id);
CREATE INDEX idx_expenses_business_date ON public.expenses (business_id, created_at DESC);
CREATE INDEX idx_audit_business_created ON public.audit_log (business_id, created_at DESC);
CREATE INDEX idx_audit_entity           ON public.audit_log (entity_type, entity_id);

-- =============================================================================
-- Row-level security
-- =============================================================================

-- SECURITY DEFINER avoids infinite recursion: profiles has its own RLS, and a
-- policy on profiles cannot query profiles.
CREATE FUNCTION public.current_business_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT business_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE FUNCTION public.current_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

ALTER TABLE public.businesses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log        ENABLE ROW LEVEL SECURITY;

CREATE POLICY businesses_own ON public.businesses
    FOR ALL USING (id = public.current_business_id());

CREATE POLICY profiles_own ON public.profiles
    FOR ALL USING (id = auth.uid());

CREATE POLICY categories_own ON public.categories
    FOR ALL USING (business_id = public.current_business_id());

CREATE POLICY products_own ON public.products
    FOR ALL USING (business_id = public.current_business_id());

CREATE POLICY sales_own ON public.sales
    FOR ALL USING (business_id = public.current_business_id());

CREATE POLICY expenses_own ON public.expenses
    FOR ALL USING (business_id = public.current_business_id());

CREATE POLICY stock_adjustments_own ON public.stock_adjustments
    FOR ALL USING (business_id = public.current_business_id());

CREATE POLICY audit_log_own ON public.audit_log
    FOR SELECT USING (business_id = public.current_business_id());

-- sale_items carry no business_id (inherited via sales); reach it through the parent.
CREATE POLICY sale_items_own ON public.sale_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.sales s
            WHERE s.id = sale_items.sale_id
              AND s.business_id = public.current_business_id()
        )
    );

-- Writes to the audit trail are server-side only.
CREATE POLICY audit_log_no_client_write ON public.audit_log
    FOR INSERT WITH CHECK (false);

-- =============================================================================
-- Triggers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_set_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER AS $$
DECLARE
    target_id uuid;
BEGIN
    target_id := COALESCE(NEW.id, OLD.id);
    INSERT INTO public.audit_log (business_id, user_id, action, entity_type, entity_id, old_values, new_values)
    VALUES (
        public.current_business_id(),
        auth.uid(),
        TG_OP,
        TG_TABLE_NAME,
        target_id,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.sales
    FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

CREATE TRIGGER products_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

CREATE TRIGGER expenses_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
