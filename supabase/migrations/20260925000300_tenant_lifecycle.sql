-- 004: tenant lifecycle
--
-- Two problems, both about closing a business.
--
-- 1. Closing a business had to work.
--    sale_items.product_id was the only ON DELETE RESTRICT foreign key in the schema, so
--    deleting a business that had traded failed on the constraint before the cascade could
--    run: products were removed while sale_items still referenced them. Postgres does not
--    guarantee the order cascades fire in, so no ordering of the existing cascades avoided
--    it. Now ON DELETE CASCADE, and a business is removed with its catalogue, its sales and
--    its audit trail.
--
-- 2. sale_items had no tenant column.
--    It was the only tenant-owned table without business_id, which forced the audit trigger
--    to attribute its rows by looking up the parent sale. During a cascade the sale is
--    already deleted when its sale_items fire, that lookup returns NULL, and the "the
--    tenant is gone, skip this audit entry" guard did not fire because it only fires when a
--    business id was resolved. The result was an audit row with business_id NULL: RLS only
--    ever matches business_id = current_business_id(), so no tenant could ever see it or
--    delete it, and it survived its own tenant. The harness caught this as "1 audit rows
--    have no tenant".
--    sale_items now carries business_id, derived from the parent sale on every write, so
--    attribution no longer depends on cascade order.
--
-- Deleting a single product that has sales history is still refused, and retiring one is
-- active = false. The two cases are told apart the same way the sale guard does it: during a
-- business cascade the owning business is already gone, which marks a tenant purge rather
-- than a single-row delete.

ALTER TABLE public.sale_items
    DROP CONSTRAINT sale_items_product_id_fkey,
    ADD CONSTRAINT sale_items_product_id_fkey
        FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE public.sale_items ADD COLUMN business_id uuid;

UPDATE public.sale_items si
   SET business_id = s.business_id
  FROM public.sales s
 WHERE s.id = si.sale_id;

ALTER TABLE public.sale_items
    ADD CONSTRAINT sale_items_business_id_fkey
        FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;

ALTER TABLE public.sale_items ALTER COLUMN business_id SET NOT NULL;

CREATE INDEX idx_sale_items_business ON public.sale_items (business_id);

-- The tenant is read from the parent sale, never from the caller: a sale belongs to exactly
-- one business, so a client cannot place a line in another tenant's ticket. A value that
-- contradicts the sale is rejected rather than silently overwritten, so a mismatch is
-- visible instead of hidden. Runs before the NOT NULL check, so callers need not supply it.
-- SECURITY DEFINER because the lookup has to see the sale regardless of the caller's RLS;
-- without it a client gets "sale does not exist" for a ticket that plainly does.
CREATE OR REPLACE FUNCTION public.sale_items_set_business()
RETURNS TRIGGER AS $$
DECLARE
    owner uuid;
BEGIN
    SELECT s.business_id INTO owner FROM public.sales s WHERE s.id = NEW.sale_id;

    IF owner IS NULL THEN
        RAISE EXCEPTION 'sale_items.sale_id % does not exist', NEW.sale_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.business_id IS NOT NULL AND NEW.business_id <> owner THEN
        RAISE EXCEPTION 'sale_items cannot claim tenant % for sale %', NEW.business_id, NEW.sale_id
            USING ERRCODE = 'check_violation';
    END IF;

    NEW.business_id := owner;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS sale_items_set_business ON public.sale_items;
CREATE TRIGGER sale_items_set_business
    BEFORE INSERT OR UPDATE OF sale_id ON public.sale_items
    FOR EACH ROW EXECUTE FUNCTION public.sale_items_set_business();

DROP POLICY IF EXISTS sale_items_own ON public.sale_items;
CREATE POLICY sale_items_own ON public.sale_items
    USING      (business_id = current_business_id())
    WITH CHECK (business_id = current_business_id());

CREATE OR REPLACE FUNCTION public.block_product_delete_with_history()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = OLD.business_id) THEN
        -- Tenant purge: the business is already gone, let the cascade proceed.
        RETURN OLD;
    END IF;

    IF EXISTS (SELECT 1 FROM public.sale_items WHERE product_id = OLD.id) THEN
        RAISE EXCEPTION 'product % has sales history; set active = false instead of deleting it', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_block_delete_with_history ON public.products;
CREATE TRIGGER products_block_delete_with_history
    BEFORE DELETE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.block_product_delete_with_history();

-- Closing a business removes its history on purpose, so record the closure in the server
-- log with the member count before the rows go. This is an irreversible delete of a
-- business's whole record and there is deliberately no audit_log row left behind.
CREATE OR REPLACE FUNCTION public.audit_business_closed()
RETURNS TRIGGER AS $$
DECLARE
    member_count integer;
BEGIN
    SELECT count(*) INTO member_count
      FROM public.profiles WHERE business_id = OLD.id;

    RAISE NOTICE 'closing business % (%) with % member(s); its catalogue, sales and audit trail are removed',
        OLD.id, OLD.name, member_count;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS businesses_audit_closed ON public.businesses;
CREATE TRIGGER businesses_audit_closed
    BEFORE DELETE ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.audit_business_closed();

-- Every audited row carries its tenant, so the audit trigger no longer needs the
-- sale_items special case: business_id now comes straight off the row. A NULL tenant is
-- skipped rather than written, because audit_log.business_id cascades from businesses and
-- RLS matches business_id = current_business_id() - a NULL row is invisible to every
-- tenant and unremovable through the API, so writing one loses the entry silently.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER AS $$
DECLARE
    target_id      uuid;
    target_business uuid;
    new_json       jsonb;
    old_json       jsonb;
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

    -- The row this entry describes. Needed to answer "which record changed?"; reading it
    -- from the jsonb avoids the unassigned OLD/NEW problem, since only one of them is
    -- populated depending on the operation.
    target_id := COALESCE(
        NULLIF(new_json ->> 'id', '')::uuid,
        NULLIF(old_json ->> 'id', '')::uuid
    );

    -- Prefer the row's own business; it is correct even when the write came from the
    -- service key and auth.uid() is NULL.
    target_business := COALESCE(
        NULLIF(new_json ->> 'business_id', '')::uuid,
        NULLIF(old_json ->> 'business_id', '')::uuid
    );

    -- Nothing to attribute it to, or the tenant is already gone: audit_log.business_id
    -- cascades from businesses, so anything written now would be deleted again immediately
    -- and would fail against the vanishing business. There is nothing to audit.
    IF target_business IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = target_business) THEN
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
-- SECURITY DEFINER because audit_log's own policy refuses every client write
-- (audit_log_no_client_write WITH CHECK (false)); the trigger still has to record
-- a sale made by an RLS-restricted role. search_path is pinned so the function
-- cannot be shadowed by a schema it does not own.
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;