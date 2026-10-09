-- 008: two defects in the review of 005
--
-- 1. apply_stock_delta returned the wrong quantity in one case.
--
--    When a line keeps its product but stops counting - it moves onto a voided sale, or
--    one becomes voided underneath it - the units being given back are the ones that were
--    actually deducted, which is OLD.quantity. The code restored NEW.quantity. It only
--    showed when the same statement also changed the quantity, because otherwise the two
--    are equal. Measured: a 3-unit line moved onto a voided sale and changed to 5 units in
--    one statement left stock at 12 instead of 10, inventing two units out of nothing, and
--    nothing complained.
--
-- 2. The close_business() guard could never fire.
--
--    It tested current_user IN ('anon', 'authenticated'), inside a SECURITY DEFINER
--    function. There current_user is the function owner, never the caller - verified on a
--    live connection, a call made as authenticated reports postgres/postgres. session_user
--    reports the same, so switching to it would not have helped either: PostgREST reaches
--    the database through one connection role and sets the caller's role per request.
--
--    It was not exploitable, because EXECUTE was already revoked from anon and
--    authenticated and granted only to service_role. That grant is the actual gate, so the
--    check is removed rather than left in place asserting a protection it does not give.
--    The harness check on this only ever saw the grant working, never the guard.
--
-- Also corrects a comment that 004 made false: sale_items does carry a business_id now, and
-- sale_items_set_business() derives it from the parent sale on every write.

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

    -- sale_items carries its own business_id since 004, and sale_items_set_business()
    -- derives it from this sale on every write, so the line can never claim another
    -- tenant. This is the second, independent check: that the product a line names
    -- belongs to the tenant that owns the ticket it sits on.
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
            -- OLD.quantity, not NEW: these are the units that were deducted, and they are
            -- what has to come back.
            UPDATE public.products SET stock = stock + old_qty
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

CREATE OR REPLACE FUNCTION public.close_business(target uuid)
RETURNS void AS $$
BEGIN
    -- No role test here, and that is deliberate. Inside a SECURITY DEFINER function
    -- current_user is the function owner for every caller, so a check written against it
    -- reads as postgres and never fires - it looks like a guard and is not one.
    --
    -- The gate is the GRANT below: EXECUTE is revoked from PUBLIC, anon and authenticated,
    -- and given only to service_role. A client session cannot reach the body at all; it
    -- gets "permission denied for function close_business" from the privilege check.
    DELETE FROM public.businesses WHERE id = target;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.close_business(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_business(uuid) TO service_role;