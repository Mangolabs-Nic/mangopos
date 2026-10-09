-- 002: schema fixes and functional gaps
--
-- Addresses, in order:
--   FIX-1  audit_row_change() is SECURITY INVOKER, so when a non-service_role
--          user inserts a sale the trigger's own audit insert is rejected by the
--          audit_log_no_client_write policy (WITH CHECK false). Every sale would
--          fail. Fix: make the function SECURITY DEFINER so it runs as owner and
--          bypasses RLS, while client INSERTs stay blocked by the same policy.
--   FIX-2  5 foreign-key columns had no index.
--   FIX-3  stock_adjustments carried a denormalized business_id that could drift
--          from its product's business. Dropped it; policy now resolves tenancy
--          through the parent product, matching sale_items.
--   GAP-1  signing up created no profiles row -> current_business_id() returned
--          NULL -> RLS hid all data with no error.
--   GAP-2  selling did not move stock.
--   GAP-3  no payment method on sales.
--   GAP-4  no currency.
--   GAP-5  no customers.
--
-- Note on roles: role is NEVER read from client signup metadata. A client that
-- could set its own role would be a privilege-escalation hole. Self-service
-- signup creates a new tenant and makes the signer its admin; joining an existing
-- tenant is server-side provisioning, never a client-supplied id.

-- =============================================================================
-- FIX-3: drop the drifting tenant key
-- =============================================================================

-- Policy first: it references the column, so dropping the column first would fail
-- with "other objects depend on it".
DROP POLICY stock_adjustments_own ON public.stock_adjustments;

ALTER TABLE public.stock_adjustments DROP COLUMN business_id;

CREATE POLICY stock_adjustments_own ON public.stock_adjustments
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = stock_adjustments.product_id
              AND p.business_id = public.current_business_id()
        )
    );

-- =============================================================================
-- GAP-3 + GAP-5: new tables
-- =============================================================================

CREATE TABLE public.payment_methods (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name        text NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('cash', 'card', 'transfer', 'other')),
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (business_id, name)
);

CREATE TABLE public.customers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name        text NOT NULL,
    phone       text,
    email       text,
    tax_id      text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- GAP-4: base currency per tenant, plus a self-describing currency on each sale.
ALTER TABLE public.businesses ADD COLUMN currency text NOT NULL DEFAULT 'NIO';
ALTER TABLE public.sales      ADD COLUMN currency text NOT NULL DEFAULT 'NIO';

-- GAP-3: record how a sale was paid.
ALTER TABLE public.sales ADD COLUMN payment_method_id uuid REFERENCES public.payment_methods(id) ON DELETE SET NULL;

-- =============================================================================
-- FIX-2: the five unindexed foreign keys, plus new ones
-- =============================================================================

CREATE INDEX idx_stock_adjustments_product ON public.stock_adjustments (product_id);
CREATE INDEX idx_stock_adjustments_user    ON public.stock_adjustments (user_id);
CREATE INDEX idx_expenses_user             ON public.expenses (user_id);
CREATE INDEX idx_audit_log_user            ON public.audit_log (user_id);
CREATE INDEX idx_payment_methods_business  ON public.payment_methods (business_id);
CREATE INDEX idx_customers_business        ON public.customers (business_id);
CREATE INDEX idx_sales_payment_method      ON public.sales (payment_method_id);

-- =============================================================================
-- RLS for the new tables
-- =============================================================================

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers      ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_methods_own ON public.payment_methods
    FOR ALL USING (business_id = public.current_business_id());

CREATE POLICY customers_own ON public.customers
    FOR ALL USING (business_id = public.current_business_id());

CREATE TRIGGER customers_set_updated_at
    BEFORE UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- GAP-1: provision a profile on signup
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    target_business uuid;
    target_role     text;
BEGIN
    -- Self-service signup always provisions a NEW tenant. Joining an existing
    -- tenant is server-side provisioning, never client metadata: a client-supplied
    -- business_id would let any signup name a tenant it does not belong to, and
    -- current_business_id() would then expose that tenant's rows.
    INSERT INTO public.businesses (name, currency)
    VALUES (
        COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'business_name', ''), 'Negocio nuevo'),
        COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'currency', ''), 'NIO')
    )
    RETURNING id INTO target_business;
    target_role := 'admin';

    INSERT INTO public.profiles (id, business_id, email, role)
    VALUES (NEW.id, target_business, NEW.email, target_role)
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Every new tenant needs a usable cash/card pair before its first sale.
CREATE OR REPLACE FUNCTION public.seed_default_payment_methods()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.payment_methods (business_id, name, kind) VALUES
        (NEW.id, 'Efectivo', 'cash'),
        (NEW.id, 'Tarjeta',  'card');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER businesses_seed_payment_methods
    AFTER INSERT ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.seed_default_payment_methods();

-- =============================================================================
-- GAP-2: move stock on sale
--
-- Trigger rather than app code, so the invariant holds no matter which path
-- writes a sale_item. products.stock has CHECK (stock >= 0), so overselling
-- fails the transaction instead of silently going negative.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.apply_stock_delta()
RETURNS TRIGGER AS $$
DECLARE
    target_product uuid;
    qty            integer;
    parent_status  text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        target_product := NEW.product_id;
        qty            := NEW.quantity;
        SELECT status INTO parent_status FROM public.sales WHERE id = NEW.sale_id;
    ELSE
        target_product := OLD.product_id;
        qty            := OLD.quantity;
        SELECT status INTO parent_status FROM public.sales WHERE id = OLD.sale_id;
    END IF;

    -- A voided sale has already had its stock restored. Moving it again would
    -- double-count, so a voided sale is treated as a no-op.
    IF parent_status = 'voided' THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'INSERT' THEN
        UPDATE public.products SET stock = stock - qty WHERE id = target_product;
    ELSE
        UPDATE public.products SET stock = stock + qty WHERE id = target_product;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER sale_items_apply_stock
    AFTER INSERT OR DELETE ON public.sale_items
    FOR EACH ROW EXECUTE FUNCTION public.apply_stock_delta();

-- Voiding is the audit trail's job, not a row delete, so the sale_items rows
-- survive. This trigger reverses the stock movement the sale had made.
CREATE OR REPLACE FUNCTION public.revert_stock_on_void()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'completed' AND NEW.status = 'voided' THEN
        UPDATE public.products p
        SET stock = p.stock + agg.qty
        FROM (
            SELECT product_id, SUM(quantity)::int AS qty
            FROM public.sale_items
            WHERE sale_id = NEW.id
            GROUP BY product_id
        ) agg
        WHERE p.id = agg.product_id;

    ELSIF OLD.status = 'voided' AND NEW.status = 'completed' THEN
        UPDATE public.products p
        SET stock = p.stock - agg.qty
        FROM (
            SELECT product_id, SUM(quantity)::int AS qty
            FROM public.sale_items
            WHERE sale_id = NEW.id
            GROUP BY product_id
        ) agg
        WHERE p.id = agg.product_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER sales_revert_stock_on_void
    AFTER UPDATE ON public.sales
    FOR EACH ROW EXECUTE FUNCTION public.revert_stock_on_void();

-- =============================================================================
-- FIX-1: the audit trigger must survive its own RLS policy
-- =============================================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
