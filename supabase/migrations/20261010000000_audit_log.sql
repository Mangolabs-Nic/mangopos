-- 010: audit_log becomes append-only, redacted, classified and complete
--
-- The trail has existed since 001 but almost nothing about it was enforced. Five
-- things are dealt with here, and the first is the one that matters.
--
--   1  Nothing kept it append-only. An entry could be edited or deleted by any role
--      that happened to hold the grant, and the whole point of an audit trail is
--      that it says what happened rather than what someone later wanted it to say.
--      audit_log now refuses UPDATE, DELETE and TRUNCATE outright, for every role
--      including service_role and the owner, and the grants are narrowed so a client
--      cannot even attempt it.
--
--   2  Evidence did not survive the thing it is evidence about. audit_log cascaded
--      from businesses and nulled from profiles, so closing a tenant - or, far more
--      often, removing one person - rewrote or erased the record of what they did.
--      Both foreign keys are dropped. An identifier that no longer resolves is a
--      fact about history, and trading attribution for referential tidiness is the
--      wrong way round. This is the only place in the project that removes a
--      constraint on purpose, and it is why the tenant-teardown check in
--      scripts/verify-schema.sql now asserts the trail is RETAINED, not purged.
--
--   3  Secrets were recorded verbatim. audit_row_change() wrote to_jsonb(NEW)
--      wholesale, so the day a column holds a PIN, a recovery answer or a token it
--      would land in the one table from which nothing can ever be deleted. Values
--      are filtered by an explicit scalar allowlist instead: an unknown column, and
--      any nested object or array, is excluded by default. Fail-closed, because an
--      audit trail cannot be corrected after the fact.
--
--   4  A void, a stock adjustment and a routine edit were the same shape of row.
--      action now names the operation (sales.void, stock.adjust) and metadata carries
--      source, operation, actor_type and a `sensitive` flag, so "what was voided, and
--      when" does not need a jsonb dig.
--
--   5  Six of the ten tables the plan treats as sensitive had no trigger at all -
--      stock_adjustments among them, the operation the plan is most explicit about.
--      Every tenant table is covered now.
--
-- Read access narrows at the same time. audit_log_own let any member of a business
-- read the whole trail; the documented access is admin full, supervisor own plus
-- their cashiers, and a cashier only their own actions.
--
-- The stock_adjustments triggers are corrected here too. They fired on every column
-- of the row, so the ON DELETE SET NULL on user_id - attribution maintenance, not a
-- stock movement - replayed the delta and moved stock a second time.

-- Preserve historical identifiers: deleting a tenant/profile must not mutate or
-- cascade-delete evidence. Historical NULL actors cannot be reconstructed.
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_business_id_fkey;

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;

ALTER TABLE public.audit_log ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX idx_audit_cursor ON public.audit_log (business_id, created_at DESC, id DESC);

-- FK SET NULL on user_id is attribution maintenance, not a stock movement.
-- Replaying the delta there breaks tenant cascades and corrupts count history.
DROP TRIGGER stock_adjustments_normalise ON public.stock_adjustments;

CREATE TRIGGER stock_adjustments_normalise
BEFORE INSERT OR UPDATE OF product_id, adjustment, quantity_before, quantity_after ON public.stock_adjustments
FOR EACH ROW EXECUTE FUNCTION public.normalise_stock_adjustment();

DROP TRIGGER stock_adjustments_apply_stock ON public.stock_adjustments;

CREATE TRIGGER stock_adjustments_apply_stock
AFTER INSERT OR DELETE OR UPDATE OF product_id, adjustment, quantity_before, quantity_after ON public.stock_adjustments
FOR EACH ROW EXECUTE FUNCTION public.apply_stock_adjustment();

CREATE FUNCTION public.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_mutation();

CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON public.audit_log
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();

REVOKE ALL ON public.audit_log FROM anon, authenticated, service_role;

GRANT SELECT ON public.audit_log TO authenticated, service_role;

DROP POLICY IF EXISTS audit_log_own ON public.audit_log;

DROP POLICY IF EXISTS audit_log_no_client_write ON public.audit_log;

-- SECURITY DEFINER needed to see other actors without expanding profile RLS.
CREATE FUNCTION public.audit_actor_is_cashier(actor_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles
    WHERE id = actor_id AND business_id = public.current_business_id() AND role = 'cashier');
$$;

CREATE POLICY audit_log_scoped ON public.audit_log FOR SELECT TO authenticated
USING (business_id = public.current_business_id()
  AND EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = auth.uid() AND me.active)
  AND (public.current_role() = 'admin' OR user_id = auth.uid()
    OR (public.current_role() = 'supervisor' AND public.audit_actor_is_cashier(user_id))));

REVOKE ALL ON FUNCTION public.audit_actor_is_cashier(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.audit_actor_is_cashier(uuid) TO authenticated;

-- Explicit scalar allowlist: new columns and nested JSON are excluded by default.
CREATE FUNCTION public.audit_safe_values(row_data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN row_data IS NULL THEN NULL ELSE COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) END
  FROM jsonb_each(COALESCE(row_data, '{}'::jsonb))
  WHERE key = ANY (ARRAY['id','business_id','user_id','product_id','sale_id',
    'category_id','payment_method_id','role','active','name','sku','price','cost',
    'stock','quantity','quantity_before','quantity_after','adjustment','reason',
    'void_reason','subtotal','tax','total','amount','status','currency','unit_price',
    'is_service','created_at','updated_at'])
    AND jsonb_typeof(value) NOT IN ('object', 'array');
$$;

CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  previous jsonb;
  following jsonb;
  row_data jsonb;
  tenant uuid;
  event_action text;
BEGIN
  IF TG_OP <> 'INSERT' THEN previous := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN following := to_jsonb(NEW); END IF;
  row_data := COALESCE(following, previous);
  tenant := (row_data->>'business_id')::uuid;
  IF TG_TABLE_NAME = 'businesses' THEN tenant := (row_data->>'id')::uuid; END IF;
  IF tenant IS NULL AND TG_TABLE_NAME = 'stock_adjustments' THEN
    SELECT business_id INTO tenant FROM public.products WHERE id = (row_data->>'product_id')::uuid;
    -- During cascade the parent product may already be gone. Its retained
    -- audit row supplies the tenant without depending on cascade ordering.
    IF tenant IS NULL THEN
      SELECT business_id INTO tenant FROM public.audit_log
      WHERE entity_type = 'products' AND entity_id = (row_data->>'product_id')::uuid
      ORDER BY created_at DESC, id DESC LIMIT 1;
    END IF;
  END IF;
  IF tenant IS NULL AND TG_TABLE_NAME = 'sale_items' THEN
    SELECT business_id INTO tenant FROM public.sales WHERE id = (row_data->>'sale_id')::uuid;
  END IF;
  event_action := lower(TG_TABLE_NAME) || '.' || lower(TG_OP);
  IF TG_TABLE_NAME = 'sales' AND TG_OP = 'UPDATE'
    AND following->>'status' = 'voided' AND previous->>'status' IS DISTINCT FROM 'voided' THEN
    event_action := 'sales.void';
  END IF;
  IF TG_TABLE_NAME = 'stock_adjustments' AND TG_OP = 'INSERT' THEN event_action := 'stock.adjust'; END IF;
  INSERT INTO public.audit_log(business_id, user_id, action, entity_type, entity_id, old_values, new_values, metadata)
  VALUES (tenant, auth.uid(), event_action, TG_TABLE_NAME, (row_data->>'id')::uuid,
    public.audit_safe_values(previous), public.audit_safe_values(following),
    jsonb_build_object('source', 'db_trigger', 'operation', TG_OP,
      'actor_type', CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
      'sensitive', TG_OP = 'DELETE' OR event_action IN ('sales.void', 'stock.adjust')));
  RETURN NULL;
END;
$$;

-- Replace the obsolete notice that claimed audit history was removed.
DROP TRIGGER IF EXISTS businesses_audit_closed ON public.businesses;

DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['businesses','profiles','categories','payment_methods',
    'products','customers','sales','sale_items','expenses','stock_adjustments'] LOOP
    -- Replace existing audit triggers without touching integrity/stock triggers.
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', target || '_audit', target);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', target || '_audit', target);
  END LOOP;
END;
$$;
