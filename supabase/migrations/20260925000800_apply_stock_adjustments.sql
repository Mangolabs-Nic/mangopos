-- 009: a stock adjustment now moves stock
--
-- stock_adjustments recorded what someone counted and never applied it. The table had one
-- trigger, and that one only checked tenancy. Recording a physical count of 10 -> 14 left
-- products.stock at 10, so the feature was inert: the audit trail and the stock disagreed
-- and nothing reconciled them.
--
-- Two things are done here rather than one.
--
-- The delta is applied. An adjustment of +4 now leaves stock at 14.
--
-- The figures the caller sends are not trusted. quantity_before and quantity_after were
-- whatever the client claimed, and adjustment_is_consistent only checks the caller against
-- itself, so a client could record "before 999, after 1000" and be believed. The count is
-- the database's to record: the product row is locked, its real stock is read, and the
-- before and after are written from that. The row lock matters, because two adjustments
-- recorded at the same moment would otherwise both read the same "before" and one of them
-- would be wrong.
--
-- Reaching stock below zero is refused by products_stock_check, which finally means
-- something here: a count cannot invent stock that is not there.
--
-- Only INSERT is reachable by a client. The matrix gives no client an UPDATE on this
-- table and revokes DELETE, so those paths exist for the server - an import correcting a
-- bad count - and both are written as give-back-then-apply so that correcting a count, or
-- moving one to a different product, cannot leave units on the wrong product.

CREATE OR REPLACE FUNCTION public.guard_stock_adjustment_tenant()
RETURNS TRIGGER AS $$
BEGIN
    -- SECURITY INVOKER, and that is the whole point of it being separate. Inside a
    -- SECURITY DEFINER function current_user is the function owner for every caller, so a
    -- definer trigger cannot tell a client from the server - and auth.uid() is not a
    -- substitute, because it survives a RESET ROLE and a server call made during a user
    -- session still reports that user's tenant.
    --
    -- As invoker this sees the real caller, and reads products under that caller's own
    -- row-level security, so the EXISTS is already "is this my product". Row-level
    -- security refuses the INSERT outright afterwards, but the guard is here so the
    -- refusal is a clear one and does not depend on policy ordering.
    IF current_user IN ('anon', 'authenticated')
       AND NOT EXISTS (SELECT 1 FROM public.products p
                        WHERE p.id = NEW.product_id
                          AND p.business_id = public.current_business_id()) THEN
        RAISE EXCEPTION 'product % belongs to another tenant', NEW.product_id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.normalise_stock_adjustment()
RETURNS TRIGGER AS $$
DECLARE
    owner      uuid;
    on_hand    integer;
    is_service boolean;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.adjustment <> 0 THEN
        -- Put back what the row used to claim, before reading what is on the shelf now.
        -- The reversal lives here rather than in the AFTER trigger because on UPDATE the
        -- check constraint is evaluated before any AFTER trigger runs, so a normalisation
        -- done there arrives too late to satisfy adjustment_is_consistent.
        UPDATE public.products SET stock = stock - OLD.adjustment WHERE id = OLD.product_id;
    END IF;

    -- Lock the row for the rest of the transaction, so "before" is a real observation
    -- rather than whatever the client last read. SECURITY DEFINER because SELECT ... FOR
    -- UPDATE also needs the UPDATE privilege, and a cashier deliberately has no UPDATE
    -- policy on products.
    SELECT p.business_id, p.stock, p.is_service
      INTO owner, on_hand, is_service
      FROM public.products p
     WHERE p.id = NEW.product_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'product % does not exist', NEW.product_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF is_service THEN
        RAISE EXCEPTION 'product % is a service and has no stock to adjust', NEW.product_id
            USING ERRCODE = 'check_violation';
    END IF;

    NEW.quantity_before := on_hand;
    NEW.quantity_after  := on_hand + NEW.adjustment;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.apply_stock_adjustment()
RETURNS TRIGGER AS $$
BEGIN
    -- INSERT and UPDATE both end with the row saying what should now be on the shelf, and
    -- an UPDATE's old figure has already been given back by normalise_stock_adjustment().
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        UPDATE public.products SET stock = stock + NEW.adjustment
         WHERE id = NEW.product_id;

    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.adjustment <> 0 THEN
            UPDATE public.products SET stock = stock - OLD.adjustment WHERE id = OLD.product_id;
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS stock_adjustments_guard_tenant ON public.stock_adjustments;
CREATE TRIGGER stock_adjustments_guard_tenant
    BEFORE INSERT OR UPDATE OF product_id ON public.stock_adjustments
    FOR EACH ROW EXECUTE FUNCTION public.guard_stock_adjustment_tenant();

DROP TRIGGER IF EXISTS stock_adjustments_normalise ON public.stock_adjustments;
CREATE TRIGGER stock_adjustments_normalise
    BEFORE INSERT OR UPDATE ON public.stock_adjustments
    FOR EACH ROW EXECUTE FUNCTION public.normalise_stock_adjustment();

DROP TRIGGER IF EXISTS stock_adjustments_apply_stock ON public.stock_adjustments;
CREATE TRIGGER stock_adjustments_apply_stock
    AFTER INSERT OR UPDATE OR DELETE ON public.stock_adjustments
    FOR EACH ROW EXECUTE FUNCTION public.apply_stock_adjustment();