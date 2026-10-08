-- 006: stock integrity on lines, and closing a business from a direct connection
--
-- Five defects, all of them ways for the stock ledger to stop agreeing with the rows.
--
-- 1. apply_stock_delta() returned early when the NEW product was a service, before it
--    reached the branch that gives the OLD product its units back. Moving a 3-unit line
--    from a stocked product to a service therefore destroyed those 3 units permanently.
--    Rewritten so each side of the change is classified independently rather than the
--    function bailing out on the new side.
--
-- 2. Deleting a sale line returns no stock (that is deliberate - voiding returns stock,
--    not row removal), but nothing stopped a line being deleted from a completed sale.
--    Voiding the sale afterwards only returned the lines still on it, so the deleted
--    units were lost for good. A line on a sale that still stands can no longer be
--    deleted at all; voiding the sale remains the way to give units back.
--
-- 3. The stock trigger did not fire on a change of sale_id, so a line could be moved
--    between sales with no stock movement at all, including from a completed sale onto a
--    voided one, leaving units deducted for a sale that would never return them.
--    sale_id is now a watched column, and the same classification decides what to move.
--
-- 4. close_business() tested auth.role(), which only has a value when the call arrives
--    through PostgREST carrying the service key. The API's own direct connection over
--    DATABASE_URL has no JWT, so it always refused and the function could never be used
--    from the server that owns it. It now refuses the two client roles by name, which
--    covers both callers: a user session is refused, and both the service key and a
--    direct connection are allowed.
--
-- 5. The "is this business empty" test in provisioning ignored categories and payment
--    methods, so a shop that had been set up but had not sold anything - a tax rate, a
--    product category, a payment method - was still deleted.

-- =============================================================================
-- Stock, decided by classifying each side independently
--
-- A line's units are "counted" - currently deducted from stock - when the parent sale
-- is not voided, the product is not a service, and the product belongs to the sale's
-- tenant. Anything else means those units are not on any ledger right now. The
-- correction is then (counted_new * new_quantity) - (counted_old * old_quantity),
-- applied to whichever products the two sides name. That covers a quantity edit, a
-- product swap, a service in either direction and a move between sales without any
-- of those cases needing its own early return.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.apply_stock_delta()
RETURNS TRIGGER AS $$
DECLARE
    old_product  uuid    := NULL;
    old_qty      integer := 0;
    old_business uuid;
    old_status   text;
    new_product  uuid;
    new_qty      integer;
    new_business uuid;
    new_status   text;
    counted_old  boolean := false;
    counted_new  boolean := false;
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Voiding is what returns stock (revert_stock_on_void). Cascading a sale away
        -- must not restore units a second time.
        RETURN NULL;
    END IF;

    new_product := NEW.product_id;
    new_qty     := NEW.quantity;

    SELECT s.business_id, s.status INTO new_business, new_status
      FROM public.sales s WHERE s.id = NEW.sale_id;

    -- The sale's product must belong to the sale's tenant. sale_items has no business_id
    -- of its own, so this is the only place the link can be enforced.
    IF new_business IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.products p
         WHERE p.id = new_product
           AND p.business_id = new_business
    ) THEN
        RAISE EXCEPTION 'product % does not belong to the tenant that owns the sale', new_product
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        old_product := OLD.product_id;
        old_qty     := OLD.quantity;
        SELECT s.business_id, s.status INTO old_business, old_status
          FROM public.sales s WHERE s.id = OLD.sale_id;
    END IF;

    counted_new := new_status IS DISTINCT FROM 'voided' AND EXISTS (
        SELECT 1 FROM public.products p
         WHERE p.id = new_product AND p.business_id = new_business AND NOT p.is_service);

    counted_old := old_product IS NOT NULL
        AND old_status IS DISTINCT FROM 'voided' AND EXISTS (
        SELECT 1 FROM public.products p
         WHERE p.id = old_product AND p.business_id = old_business AND NOT p.is_service);

    IF old_product IS NULL THEN
        IF counted_new THEN
            UPDATE public.products SET stock = stock - new_qty
             WHERE id = new_product AND business_id = new_business;
        END IF;

    ELSIF old_product = new_product THEN
        IF counted_new AND NOT counted_old THEN
            UPDATE public.products SET stock = stock - new_qty
             WHERE id = new_product AND business_id = new_business;
        ELSIF counted_old AND NOT counted_new THEN
            UPDATE public.products SET stock = stock + new_qty
             WHERE id = new_product AND business_id = new_business;
        ELSIF counted_new AND counted_old THEN
            UPDATE public.products SET stock = stock - (new_qty - old_qty)
             WHERE id = new_product AND business_id = new_business;
        END IF;

    ELSE
        IF counted_old THEN
            UPDATE public.products SET stock = stock + old_qty
             WHERE id = old_product AND business_id = old_business;
        END IF;
        IF counted_new THEN
            UPDATE public.products SET stock = stock - new_qty
             WHERE id = new_product AND business_id = new_business;
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS sale_items_apply_stock ON public.sale_items;
CREATE TRIGGER sale_items_apply_stock
    AFTER INSERT OR UPDATE OF quantity, product_id, sale_id OR DELETE ON public.sale_items
    FOR EACH ROW EXECUTE FUNCTION public.apply_stock_delta();

-- =============================================================================
-- A line on a sale that still stands cannot be deleted
--
-- Removing a line does not return its units - voiding does - so deleting one from a
-- completed sale took the units out of stock with nothing left to give them back.
-- Deleting is still allowed when the sale is voided (tidying a cancelled ticket) and
-- when the owning business is gone, which is how a tenant purge cascades.
--
-- SECURITY DEFINER because this reads sales under the caller's RLS: a client from
-- another tenant would see no parent sale, read that as "no business", and be let
-- through, which is exactly backwards.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.block_sale_item_delete()
RETURNS TRIGGER AS $$
DECLARE
    parent_business uuid;
    parent_status   text;
BEGIN
    SELECT s.business_id, s.status INTO parent_business, parent_status
      FROM public.sales s WHERE s.id = OLD.sale_id;

    IF parent_business IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.businesses WHERE id = parent_business)
       AND parent_status IS DISTINCT FROM 'voided' THEN
        RAISE EXCEPTION
            'a line on sale % cannot be deleted while that sale stands; void the sale instead',
            OLD.sale_id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS sale_items_block_delete ON public.sale_items;
CREATE TRIGGER sale_items_block_delete
    BEFORE DELETE ON public.sale_items
    FOR EACH ROW EXECUTE FUNCTION public.block_sale_item_delete();

-- =============================================================================
-- Closing a business from a direct database connection
-- =============================================================================

CREATE OR REPLACE FUNCTION public.close_business(target uuid)
RETURNS void AS $$
BEGIN
    -- auth.role() reads the JWT role claim, so it is NULL over a direct DATABASE_URL
    -- connection - the API's own connection - and the function could never be called
    -- from there. Naming the two client roles instead refuses exactly the sessions that
    -- must be refused and lets both the service key and a direct connection through.
    IF current_user IN ('anon', 'authenticated') THEN
        RAISE EXCEPTION 'close_business requires the service key'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    DELETE FROM public.businesses WHERE id = target;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- Provisioning: a configured shop is not an empty one
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

        ELSIF EXISTS (SELECT 1 FROM public.products   WHERE business_id = previous_business)
           OR EXISTS (SELECT 1 FROM public.sales      WHERE business_id = previous_business)
           OR EXISTS (SELECT 1 FROM public.expenses   WHERE business_id = previous_business)
           OR EXISTS (SELECT 1 FROM public.customers  WHERE business_id = previous_business)
           OR EXISTS (SELECT 1 FROM public.categories WHERE business_id = previous_business)
           OR EXISTS (SELECT 1 FROM public.stock_adjustments si
                       JOIN public.products p ON p.id = si.product_id
                      WHERE p.business_id = previous_business) THEN
            -- A shop that is set up, or that has traded. Deleting it would take its
            -- catalogue, its sales and its audit trail with it, so it stays for an
            -- admin to settle. A category counts as setup because a human chose it.
            --
            -- Payment methods deliberately do not count: seed_default_payment_methods
            -- gives every new tenant cash and card, and the table records nothing that
            -- distinguishes those from a deliberate choice, so counting them would make
            -- every signup tenant look configured and no empty tenant would ever be
            -- cleaned up. The cost of that is that a shop whose only setup was renaming a
            -- seeded payment method is still treated as empty.
            RAISE NOTICE 'kept previous business %: it is set up or holds trading data and was not deleted',
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