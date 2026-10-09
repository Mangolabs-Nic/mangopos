-- 007: the role matrix
--
-- Every tenant table had a single FOR ALL policy, so the lowest-privileged member of a
-- business could rewrite the ledger inside it: change a completed sale's total, set a
-- price, restock by deleting a stock adjustment. Each FOR ALL policy is replaced by
-- per-command policies over three roles.
--
--   cashier     takes a sale, records an expense, counts stock
--   supervisor  everything a cashier does, plus the catalogue and the numbers on it
--   admin       everything, plus deletions, roles and tenant settings
--
-- The rule underneath all of it: a completed sale is a fact, not a draft. It is written
-- once and thereafter only voided, and voiding requires a reason. That is the invariant
-- the legacy app was trying to hold with its mandatory motivo_anulacion, but it never
-- applied to the value of a sale, only to its status.
--
-- Row-level security governs which rows a role may touch, not which columns, so the two
-- column-level rules - price and cost, and role escalation - are enforced by triggers.
--
-- RLS does not apply to the server: service_role bypasses it, and so does the owner, so
-- the trigger guards exempt the case where there is no user session at all. An
-- authenticated caller always has auth.uid(), and an anonymous one is already stopped by
-- current_business_id() being NULL.

CREATE OR REPLACE FUNCTION public.can_manage()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.current_role() IN ('supervisor', 'admin') $$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.current_role() = 'admin' $$;

-- Every policy on these tables is replaced. businesses and audit_log are not listed:
-- their policies were narrowed deliberately and none of them is part of this matrix.
DO $$
DECLARE
    existing record;
BEGIN
    FOR existing IN
        SELECT policyname, tablename
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = ANY (ARRAY[
               'categories', 'payment_methods', 'products', 'customers', 'expenses',
               'sales', 'sale_items', 'stock_adjustments', 'profiles'])
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                       existing.policyname, existing.tablename);
    END LOOP;
END $$;

-- =============================================================================
-- Catalogue: a supervisor or admin writes it, only an admin deletes it
-- =============================================================================

CREATE POLICY categories_select_own ON public.categories
    FOR SELECT USING (business_id = current_business_id());
CREATE POLICY categories_insert_manage ON public.categories
    FOR INSERT WITH CHECK (business_id = current_business_id() AND can_manage());
CREATE POLICY categories_update_manage ON public.categories
    FOR UPDATE USING (business_id = current_business_id() AND can_manage())
                WITH CHECK (business_id = current_business_id());
CREATE POLICY categories_delete_admin ON public.categories
    FOR DELETE USING (business_id = current_business_id() AND is_admin());

CREATE POLICY payment_methods_select_own ON public.payment_methods
    FOR SELECT USING (business_id = current_business_id());
CREATE POLICY payment_methods_insert_manage ON public.payment_methods
    FOR INSERT WITH CHECK (business_id = current_business_id() AND can_manage());
CREATE POLICY payment_methods_update_manage ON public.payment_methods
    FOR UPDATE USING (business_id = current_business_id() AND can_manage())
                WITH CHECK (business_id = current_business_id());
CREATE POLICY payment_methods_delete_admin ON public.payment_methods
    FOR DELETE USING (business_id = current_business_id() AND is_admin());

CREATE POLICY products_select_own ON public.products
    FOR SELECT USING (business_id = current_business_id());
CREATE POLICY products_insert_manage ON public.products
    FOR INSERT WITH CHECK (business_id = current_business_id() AND can_manage());
CREATE POLICY products_update_manage ON public.products
    FOR UPDATE USING (business_id = current_business_id() AND can_manage())
                WITH CHECK (business_id = current_business_id());
-- Only an admin, and even then only a product that was never sold: the delete trigger
-- refuses the rest, because a product on a past ticket is part of that ticket's history.
CREATE POLICY products_delete_admin ON public.products
    FOR DELETE USING (business_id = current_business_id() AND is_admin());

CREATE POLICY customers_select_own ON public.customers
    FOR SELECT USING (business_id = current_business_id());
CREATE POLICY customers_insert_manage ON public.customers
    FOR INSERT WITH CHECK (business_id = current_business_id() AND can_manage());
CREATE POLICY customers_update_manage ON public.customers
    FOR UPDATE USING (business_id = current_business_id() AND can_manage())
                WITH CHECK (business_id = current_business_id());
CREATE POLICY customers_delete_admin ON public.customers
    FOR DELETE USING (business_id = current_business_id() AND is_admin());

-- Price and cost are the two numbers that decide whether the business is solvent, and a
-- cashier must not be able to set either. RLS cannot see columns, so this is a trigger.
--
-- SECURITY INVOKER on purpose. The test is which database role is calling, and inside a
-- SECURITY DEFINER function current_user is the function owner, so a definer trigger
-- cannot see it - it would see postgres and exempt everything. As invoker this sees the
-- real caller: authenticated is a client and is held to the role, service_role and a
-- direct DATABASE_URL connection are the server and bypass row-level security anyway.
-- The role itself is read through can_manage(), which is SECURITY DEFINER, so it still
-- resolves against the signed-in user rather than the invoking role.
CREATE OR REPLACE FUNCTION public.guard_product_pricing()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.price IS DISTINCT FROM OLD.price OR NEW.cost IS DISTINCT FROM OLD.cost)
       AND current_user IN ('anon', 'authenticated')
       AND NOT can_manage() THEN
        RAISE EXCEPTION 'only a supervisor or admin may change price or cost'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_guard_pricing ON public.products;
CREATE TRIGGER products_guard_pricing
    BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.guard_product_pricing();

-- =============================================================================
-- Expenses: anyone records one, only a supervisor or admin rewrites it, only an admin
-- removes it
-- =============================================================================

CREATE POLICY expenses_select_own ON public.expenses
    FOR SELECT USING (business_id = current_business_id());
CREATE POLICY expenses_insert_any ON public.expenses
    FOR INSERT WITH CHECK (business_id = current_business_id());
CREATE POLICY expenses_update_manage ON public.expenses
    FOR UPDATE USING (business_id = current_business_id() AND can_manage())
                WITH CHECK (business_id = current_business_id());
CREATE POLICY expenses_delete_admin ON public.expenses
    FOR DELETE USING (business_id = current_business_id() AND is_admin());

-- =============================================================================
-- The ledger
--
-- A sale is inserted once. Afterwards the only permitted change is the void, which needs
-- a reason, and that is the whole of what a supervisor or admin may do to it. Deleting a
-- sale is not offered to anybody: block_hard_delete refuses it and voiding is the
-- correction. A cashier therefore cannot edit a completed sale at all.
-- =============================================================================

CREATE POLICY sales_select_own ON public.sales
    FOR SELECT USING (business_id = current_business_id());
CREATE POLICY sales_insert_any ON public.sales
    FOR INSERT WITH CHECK (business_id = current_business_id());
CREATE POLICY sales_update_manage ON public.sales
    FOR UPDATE USING (business_id = current_business_id() AND can_manage())
                WITH CHECK (business_id = current_business_id());

CREATE OR REPLACE FUNCTION public.guard_sale_ledger()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'voided' THEN
        RAISE EXCEPTION 'sale % is voided and can no longer be changed', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;

    -- The void is the only permitted change: status and a reason, nothing else. Comparing
    -- the whole row rather than naming fields means a column added later is covered too.
    IF (to_jsonb(NEW) - 'status' - 'void_reason')
       IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'void_reason') THEN
        RAISE EXCEPTION 'a completed sale cannot be edited; void it with a reason instead'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS sales_guard_ledger ON public.sales;
CREATE TRIGGER sales_guard_ledger
    BEFORE UPDATE ON public.sales
    FOR EACH ROW EXECUTE FUNCTION public.guard_sale_ledger();

-- A line is inserted while the sale is being rung up, and may only be changed or removed
-- once that sale is voided - the same contract block_sale_item_delete already enforces for
-- deletes, now at the policy level so a client is stopped by the database rather than by
-- a trigger it never reaches.
CREATE POLICY sale_items_select_own ON public.sale_items
    FOR SELECT USING (business_id = current_business_id());
CREATE POLICY sale_items_insert_any ON public.sale_items
    FOR INSERT WITH CHECK (business_id = current_business_id());
CREATE POLICY sale_items_update_voided ON public.sale_items
    FOR UPDATE USING (
        business_id = current_business_id()
        AND EXISTS (SELECT 1 FROM public.sales s
                     WHERE s.id = sale_items.sale_id AND s.status = 'voided'))
    WITH CHECK (business_id = current_business_id());
CREATE POLICY sale_items_delete_voided ON public.sale_items
    FOR DELETE USING (
        business_id = current_business_id()
        AND EXISTS (SELECT 1 FROM public.sales s
                     WHERE s.id = sale_items.sale_id AND s.status = 'voided'));

-- SECURITY INVOKER, and only clients are held: sale_items_update_voided already refuses a
-- client from touching a line on a live sale, so this is the second gate, and it has to
-- let the server through. A rebuild or an import corrects lines in place, and
-- apply_stock_delta is what keeps the stock honest when it does - which is the whole point
-- of having rewritten that trigger. SECURITY INVOKER because inside a definer function
-- current_user is the function owner, so a definer trigger could not tell the two apart.
CREATE OR REPLACE FUNCTION public.guard_sale_item_change()
RETURNS TRIGGER AS $$
DECLARE
    parent_status text;
BEGIN
    IF current_user IN ('anon', 'authenticated') THEN
        SELECT s.status INTO parent_status FROM public.sales s WHERE s.id = OLD.sale_id;

        IF parent_status IS DISTINCT FROM 'voided' THEN
            RAISE EXCEPTION 'a line on a live sale cannot be changed; void the sale instead'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sale_items_guard_change ON public.sale_items;
CREATE TRIGGER sale_items_guard_change
    BEFORE UPDATE ON public.sale_items
    FOR EACH ROW EXECUTE FUNCTION public.guard_sale_item_change();

-- Stock is corrected by adding a row, never by removing one. reason is already NOT NULL,
-- so an adjustment always says why.
CREATE POLICY stock_adjustments_select_own ON public.stock_adjustments
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.products p
                 WHERE p.id = stock_adjustments.product_id
                   AND p.business_id = current_business_id()));
CREATE POLICY stock_adjustments_insert_any ON public.stock_adjustments
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.products p
                 WHERE p.id = stock_adjustments.product_id
                   AND p.business_id = current_business_id()));

-- =============================================================================
-- People
--
-- Roles are only ever set by an admin, and never on their own row. That second half is the
-- legacy app's self-escalation, where anyone who could edit an employee could tick every
-- permission box on their own record, closed.
-- =============================================================================

CREATE POLICY profiles_select_own ON public.profiles
    FOR SELECT USING (
        id = auth.uid()
        OR (business_id = current_business_id() AND is_admin()));
CREATE POLICY profiles_update_admin ON public.profiles
    FOR UPDATE USING (
        business_id = current_business_id() AND is_admin() AND id <> auth.uid())
    WITH CHECK (
        business_id = current_business_id() AND id <> auth.uid());

-- =============================================================================
-- Grants
--
-- Row-level security already denies a command with no policy, but the grants are narrowed
-- to match so the intent is readable from the schema alone, and so a future policy cannot
-- accidentally re-open one of these by naming the wrong table.
-- =============================================================================

-- sale_items keeps its DELETE grant on purpose: a voided sale can still be tidied, and
-- sale_items_delete_voided is what allows it. Removing a line does not return stock, so
-- tidying a voided sale cannot restock anything twice. Stated as a GRANT because REVOKE is
-- sticky - simply omitting it from the list above would not undo an earlier revoke.
GRANT DELETE ON public.sale_items TO authenticated;

REVOKE DELETE ON public.sales, public.stock_adjustments,
                  public.profiles, public.audit_log FROM anon, authenticated;
REVOKE INSERT, UPDATE ON public.audit_log FROM anon, authenticated;

-- Members of a tenant may not delete their own membership: removing the last admin would
-- leave a tenant nobody can administer.
CREATE OR REPLACE FUNCTION public.guard_profile_role_change()
RETURNS TRIGGER AS $$
BEGIN
    -- SECURITY INVOKER for the same reason as guard_product_pricing: the caller has to be
    -- identified by its database role, which a definer function cannot see.
    IF NEW.role IS DISTINCT FROM OLD.role
       AND current_user IN ('anon', 'authenticated')
       AND NOT is_admin() THEN
        RAISE EXCEPTION 'only an admin may change a role'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Deliberately no "keep at least one admin" rule here. An earlier version had one and
    -- it was wrong twice over: it fired while the row still held its old value, so the
    -- EXISTS found the row itself and never fired at all, and once that was fixed it
    -- blocked the signup cleanup, where the sole admin of a throwaway tenant is reassigned
    -- to a real one. A client cannot strand a tenant anyway - demoting the last admin
    -- requires being that admin, and nobody may change their own row - so the rule would
    -- only ever have bitten the server.

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_guard_role ON public.profiles;
CREATE TRIGGER profiles_guard_role
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.guard_profile_role_change();
