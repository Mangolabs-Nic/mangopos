-- 003: tenant isolation, stock integrity and audit attribution
--
-- Closes the defects reproduced against the local database:
--   1  Cross-tenant stock: sale_items carries no business_id and its policy only
--      checked the parent sale, so a cashier could attach tenant B's product to
--      their own sale. apply_stock_delta() then ran SECURITY DEFINER and
--      decremented tenant B's stock. Reproduced: B's stock 1 -> 0.
--   2  Deleting a voided sale restocked twice. sale_items cascades from sales, so
--      by the time the AFTER DELETE trigger ran, SELECT status FROM sales
--      returned NULL, the "voided" guard was skipped and the units were added
--      again. Reproduced: stock 1 -> void -> 1 -> delete -> 2.
--   3  Service products could not be sold. The trigger ignored is_service, so a
--      stockless service drove stock to -1 and violated products_stock_check,
--      failing the whole transaction.
--   4  profiles.email was NOT NULL, so phone and anonymous signups failed inside
--      handle_new_user(). Joining an existing tenant was also impossible: the
--      function always created a new business.
--   5  audit_row_change() took business from current_business_id(), which is NULL
--      whenever the write is made with the service key. Rows were written but not
--      attributable to any tenant. Reproduced: 8 rows, 8 with business_id NULL.
--   6  Editing a sale_item's quantity or product did not move stock at all: the
--      trigger only covered INSERT and DELETE.
--
-- A sale is never hard-deleted: voiding is the audit trail's job. This trigger
-- enforces that, while still allowing a business cascade to remove its own data.

-- =============================================================================
-- FIX-4: a profile does not require an email
-- =============================================================================

ALTER TABLE public.profiles ALTER COLUMN email DROP NOT NULL;

-- =============================================================================
-- FIX-4: server-side provisioning into an existing tenant
--
-- Self-service signup still always creates a new tenant (client metadata is never
-- trusted for tenancy). Joining an existing business is this function, which is
-- service_role-only: there is no policy granting it to any other role.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.provision_user_for_business(
    target_user_id  uuid,
    target_business uuid,
    target_role     text DEFAULT 'cashier'
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    created public.profiles;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = target_business) THEN
        RAISE EXCEPTION 'business % does not exist', target_business;
    END IF;

    INSERT INTO public.profiles (id, business_id, email, role)
    VALUES (
        target_user_id,
        target_business,
        (SELECT email FROM auth.users WHERE id = target_user_id),
        target_role
    )
    ON CONFLICT (id) DO UPDATE
        SET business_id = EXCLUDED.business_id,
            role        = EXCLUDED.role
    RETURNING * INTO created;

    RETURN created;
END;
$$;

-- Revoke from PUBLIC *and* from the client roles. Supabase grants EXECUTE on new
-- functions to anon/authenticated through default privileges, which REVOKE FROM
-- PUBLIC alone does not undo - leaving them able to call this and attach
-- themselves to any tenant.
REVOKE ALL ON FUNCTION public.provision_user_for_business(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_user_for_business(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_user_for_business(uuid, uuid, text) TO service_role;

-- An admin adding a staff member by phone has no email either.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    target_business uuid;
BEGIN
    -- Self-service signup always provisions a NEW tenant. Joining an existing
    -- tenant goes through provision_user_for_business(), never client metadata.
    INSERT INTO public.businesses (name, currency)
    VALUES (
        COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'business_name', ''), 'Negocio nuevo'),
        COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'currency', ''), 'NIO')
    )
    RETURNING id INTO target_business;

    -- email is nullable now: phone and anonymous signups have none.
    INSERT INTO public.profiles (id, business_id, email, role)
    VALUES (NEW.id, target_business, NULLIF(NEW.email, ''), 'admin')
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- FIX-5: attribute every audit row to a business
-- =============================================================================

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER AS $$
DECLARE
    target_id      uuid;
    target_business uuid;
    new_json       jsonb;
    old_json       jsonb;
    parent_sale    uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        new_json := NULL;
        old_json := to_jsonb(OLD);
    ELSE
        new_json := to_jsonb(NEW);
        IF TG_OP = 'UPDATE' THEN
            old_json := to_jsonb(OLD);
        ELSE
            old_json := NULL;
        END IF;
    END IF;

    -- The row this entry describes. Needed to answer "which record changed?";
    -- reading it from the jsonb avoids the unassigned OLD/NEW problem, since only
    -- one of them is populated depending on the operation.
    target_id := COALESCE(
        NULLIF(new_json ->> 'id', '')::uuid,
        NULLIF(old_json ->> 'id', '')::uuid
    );

    -- Prefer the row's own business; it is correct even when the write came from
    -- the service key and auth.uid() is NULL.
    target_business := COALESCE(
        NULLIF(new_json ->> 'business_id', '')::uuid,
        NULLIF(old_json ->> 'business_id', '')::uuid
    );

    -- sale_items had no business_id at this point, so reach through the parent sale, preferring the
    -- NEW value so a row that moved between sales is attributed to its new owner.
    IF target_business IS NULL AND TG_TABLE_NAME = 'sale_items' THEN
        parent_sale := COALESCE(
            NULLIF(new_json ->> 'sale_id', '')::uuid,
            NULLIF(old_json ->> 'sale_id', '')::uuid
        );
        IF parent_sale IS NOT NULL THEN
            SELECT s.business_id INTO target_business FROM public.sales s WHERE s.id = parent_sale;
        END IF;
    END IF;

    -- audit_log.business_id cascades from businesses, so anything written while a
    -- tenant is being removed is deleted again immediately - and the insert would
    -- fail against the vanishing business. Skip it: there is nothing to audit.
    IF target_business IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = target_business) THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.audit_log (business_id, user_id, action, entity_type, entity_id, old_values, new_values)
    VALUES (
        target_business,
        auth.uid(),
        TG_OP,
        TG_TABLE_NAME,
        target_id,
        old_json,
        new_json
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- FIX-1 + FIX-2 + FIX-3 + FIX-6: one correct stock movement
--
--   INSERT   deduct the line
--   DELETE   no-op: stock returns when a sale is voided, never on row removal
--   UPDATE   adjust by the difference, or move the units if the product changed
--
-- Tenant is resolved from the parent sale and re-checked against the product, so
-- neither RLS nor SECURITY DEFINER can move another tenant's stock.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.apply_stock_delta()
RETURNS TRIGGER AS $$
DECLARE
    target_product uuid;
    qty            integer;
    parent_business uuid;
    product_business uuid;
    product_is_service boolean;
    parent_status  text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Voiding is what returns stock (revert_stock_on_void). Cascading a sale
        -- away must not restore units a second time, and a completed sale must not
        -- be deletable at all - see sales_block_hard_delete below.
        RETURN NULL;
    END IF;

    target_product := NEW.product_id;
    qty            := NEW.quantity;

    SELECT s.business_id, s.status INTO parent_business, parent_status
      FROM public.sales s WHERE s.id = NEW.sale_id;

    -- FIX-1: the sale's product must belong to the sale's tenant. sale_items has no
    -- business_id of its own, so this is the only place the link can be enforced.
    IF parent_business IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.products p
         WHERE p.id = target_product
           AND p.business_id = parent_business
    ) THEN
        RAISE EXCEPTION 'product % does not belong to the tenant that owns the sale', target_product
            USING ERRCODE = 'check_violation';
    END IF;

    -- A voided sale already had its stock returned; do not move it again.
    IF parent_status = 'voided' THEN
        RETURN NULL;
    END IF;

    SELECT p.business_id, p.is_service INTO product_business, product_is_service
      FROM public.products p WHERE p.id = target_product;

    -- FIX-3: services have no stock to move.
    IF product_is_service THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'INSERT' THEN
        UPDATE public.products SET stock = stock - qty
         WHERE id = target_product AND business_id = parent_business;

    ELSIF TG_OP = 'UPDATE' THEN
        -- FIX-6: the product may have changed, and the quantity certainly can.
        IF OLD.product_id IS DISTINCT FROM NEW.product_id THEN
            SELECT p.business_id, p.is_service INTO product_business, product_is_service
              FROM public.products p WHERE p.id = OLD.product_id;

            IF NOT product_is_service AND product_business = parent_business THEN
                UPDATE public.products SET stock = stock + OLD.quantity
                 WHERE id = OLD.product_id AND business_id = parent_business;
            END IF;

            SELECT p.business_id, p.is_service INTO product_business, product_is_service
              FROM public.products p WHERE p.id = NEW.product_id;

            IF NOT product_is_service AND product_business = parent_business THEN
                UPDATE public.products SET stock = stock - NEW.quantity
                 WHERE id = NEW.product_id AND business_id = parent_business;
            END IF;

        ELSIF OLD.quantity IS DISTINCT FROM NEW.quantity THEN
            UPDATE public.products SET stock = stock - (NEW.quantity - OLD.quantity)
             WHERE id = target_product AND business_id = parent_business;
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS sale_items_apply_stock ON public.sale_items;
CREATE TRIGGER sale_items_apply_stock
    AFTER INSERT OR UPDATE OF quantity, product_id OR DELETE ON public.sale_items
    FOR EACH ROW EXECUTE FUNCTION public.apply_stock_delta();

-- Voiding a sale restores stock; a hard delete must not, so forbid one. The check
-- is "does the owning business still exist", which is false once a businesses
-- cascade is under way, so tenant teardown still works.
CREATE OR REPLACE FUNCTION public.block_hard_delete()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.businesses WHERE id = OLD.business_id) THEN
        RAISE EXCEPTION 'sales are voided, never deleted; set status = ''voided'' with a reason'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sales_block_hard_delete ON public.sales;
CREATE TRIGGER sales_block_hard_delete
    BEFORE DELETE ON public.sales
    FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

-- =============================================================================
-- Re-attribute audit rows written before this migration, so the existing trail
-- stops being invisible. sale_items rows are attributed through their sale.
-- =============================================================================

UPDATE public.audit_log a
   SET business_id = s.business_id
  FROM public.sales s
 WHERE a.business_id IS NULL
   AND a.entity_type = 'sales'
   AND s.id = a.entity_id;

UPDATE public.audit_log a
   SET business_id = s.business_id
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
 WHERE a.business_id IS NULL
   AND a.entity_type = 'sale_items'
   AND si.id = a.entity_id;

-- Audit the line items too: their edits are exactly what fix 6 had to cover.
DROP TRIGGER IF EXISTS sale_items_audit ON public.sale_items;
CREATE TRIGGER sale_items_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.sale_items
    FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- =============================================================================
-- FIX-7: a foreign key must not cross a tenant boundary
--
-- categories, payment_methods and profiles all carry their own business_id, but a
-- plain REFERENCES constraint only checks that the id exists. Tenant A could
-- therefore point a product at tenant B's category, or record a sale against
-- tenant B's employee. The referenced rows would then be reachable by joining
-- across tenants.
--
-- SECURITY DEFINER because the referenced tables have their own RLS.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_tenant_reference()
RETURNS TRIGGER AS $$
DECLARE
    ref_column   text := TG_ARGV[0];
    ref_table    text := TG_ARGV[1];
    via          text := TG_ARGV[2];  -- optional 'table.column' holding the tenancy
    row_business uuid;
    ref_value    uuid;
    ref_business uuid;
    via_parts    text[];
BEGIN
    IF via IS NOT NULL THEN
        -- Postgres array subscripts start at 1, so [1] is the table and [2] the
        -- column. Reading [0] yields NULL and format('%I', NULL) raises, which
        -- would break every write to the table.
        via_parts := string_to_array(via, '.');
        IF array_length(via_parts, 1) <> 2 THEN
            RAISE EXCEPTION 'invalid tenancy reference %', via;
        END IF;
        EXECUTE format('SELECT p.business_id FROM public.%I p WHERE p.id = $1', via_parts[1])
            INTO row_business
            USING NULLIF(to_jsonb(NEW) ->> via_parts[2], '')::uuid;
    ELSE
        row_business := NULLIF(to_jsonb(NEW) ->> 'business_id', '')::uuid;
    END IF;

    ref_value := NULLIF(to_jsonb(NEW) ->> ref_column, '')::uuid;
    IF row_business IS NULL OR ref_value IS NULL THEN
        RETURN NEW;
    END IF;

    EXECUTE format('SELECT r.business_id FROM public.%I r WHERE r.id = $1', ref_table)
        INTO ref_business USING ref_value;

    IF ref_business IS DISTINCT FROM row_business THEN
        RAISE EXCEPTION '%.% references % %, which belongs to another tenant',
            TG_TABLE_NAME, ref_column, ref_table, ref_value
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS products_tenant_category ON public.products;
CREATE TRIGGER products_tenant_category
    BEFORE INSERT OR UPDATE OF category_id, business_id ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_reference('category_id', 'categories');

DROP TRIGGER IF EXISTS sales_tenant_payment_method ON public.sales;
CREATE TRIGGER sales_tenant_payment_method
    BEFORE INSERT OR UPDATE OF payment_method_id, business_id ON public.sales
    FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_reference('payment_method_id', 'payment_methods');

DROP TRIGGER IF EXISTS sales_tenant_user ON public.sales;
CREATE TRIGGER sales_tenant_user
    BEFORE INSERT OR UPDATE OF user_id, business_id ON public.sales
    FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_reference('user_id', 'profiles');

DROP TRIGGER IF EXISTS expenses_tenant_user ON public.expenses;
CREATE TRIGGER expenses_tenant_user
    BEFORE INSERT OR UPDATE OF user_id, business_id ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_reference('user_id', 'profiles');

-- stock_adjustments lost its own business_id in migration 002 (it used to drift),
-- so its tenancy comes from the product it adjusts.
DROP TRIGGER IF EXISTS stock_adjustments_tenant_user ON public.stock_adjustments;
CREATE TRIGGER stock_adjustments_tenant_user
    BEFORE INSERT OR UPDATE ON public.stock_adjustments
    FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_reference('user_id', 'profiles', 'products.product_id');

-- =============================================================================
-- FIX-8: provisioning must not leave the signup business behind
--
-- Self-service signup always creates a business, so reassigning that user into an
-- existing tenant used to leave an empty tenant behind. Remove it ONLY when it is
-- genuinely empty.
--
-- "No other profile belongs to it" is not enough: products, sales, expenses,
-- customers and the audit trail all cascade from businesses, so a shop that has
-- traded would be destroyed along with its history. A user who signs up, runs
-- their own shop and later takes a shift elsewhere keeps that shop.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.provision_user_for_business(
    target_user_id  uuid,
    target_business uuid,
    target_role     text DEFAULT 'cashier'
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    created           public.profiles;
    previous_business uuid;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = target_business) THEN
        RAISE EXCEPTION 'business % does not exist', target_business;
    END IF;

    SELECT p.business_id INTO previous_business
      FROM public.profiles p WHERE p.id = target_user_id;

    INSERT INTO public.profiles (id, business_id, email, role)
    VALUES (
        target_user_id,
        target_business,
        (SELECT email FROM auth.users WHERE id = target_user_id),
        target_role
    )
    ON CONFLICT (id) DO UPDATE
        SET business_id = EXCLUDED.business_id,
            role        = EXCLUDED.role
    RETURNING * INTO created;

    IF previous_business IS NOT NULL AND previous_business <> target_business THEN
        IF EXISTS (SELECT 1 FROM public.profiles
                   WHERE business_id = previous_business AND id <> target_user_id) THEN
            RAISE NOTICE 'kept previous business %: it still has members', previous_business;

        ELSIF EXISTS (SELECT 1 FROM public.products  WHERE business_id = previous_business)
           OR EXISTS (SELECT 1 FROM public.sales     WHERE business_id = previous_business)
           OR EXISTS (SELECT 1 FROM public.expenses  WHERE business_id = previous_business)
           OR EXISTS (SELECT 1 FROM public.customers WHERE business_id = previous_business)
           OR EXISTS (SELECT 1 FROM public.stock_adjustments si
                       JOIN public.products p ON p.id = si.product_id
                      WHERE p.business_id = previous_business) THEN
            -- A real shop. Deleting it would take its catalogue, its sales and its
            -- audit trail with it, so it stays for an admin to settle.
            RAISE NOTICE 'kept previous business %: it holds trading data and was not deleted',
                previous_business;

        ELSE
            DELETE FROM public.businesses WHERE id = previous_business;
        END IF;
    END IF;

    RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_user_for_business(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_user_for_business(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_user_for_business(uuid, uuid, text) TO service_role;

-- =============================================================================
-- FIX-9: voiding must not invent stock for a service
--
-- Selling a service moves no stock (see apply_stock_delta), so returning stock on
-- void credited a service with units it never had - a stockless service went from
-- 0 to 1 after being voided.
-- =============================================================================

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
        WHERE p.id = agg.product_id
          AND p.is_service = false;

    ELSIF OLD.status = 'voided' AND NEW.status = 'completed' THEN
        UPDATE public.products p
        SET stock = p.stock - agg.qty
        FROM (
            SELECT product_id, SUM(quantity)::int AS qty
            FROM public.sale_items
            WHERE sale_id = NEW.id
            GROUP BY product_id
        ) agg
        WHERE p.id = agg.product_id
          AND p.is_service = false;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
