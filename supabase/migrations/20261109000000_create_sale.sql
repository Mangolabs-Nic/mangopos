-- A sale and its lines are one transaction, priced from the catalogue.
--
-- PostgREST cannot insert a parent and its children in one request on this
-- project, and two requests would leave a header behind when a line fails.
-- SECURITY INVOKER keeps RLS in charge: the function can only read the
-- caller's products and can only insert into the caller's business.

CREATE OR REPLACE FUNCTION public.create_sale(
  p_business_id       uuid,
  p_user_id           uuid,
  p_items             jsonb,
  p_tax               numeric DEFAULT 0,
  p_payment_method_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_currency   text;
  v_sale_id    uuid;
  v_subtotal   numeric(12,2) := 0;
  v_line_total numeric(12,2);
  v_units      integer;
  v_product    public.products%ROWTYPE;
  v_grouped    jsonb;
  v_lines      jsonb := '[]'::jsonb;
  v_item       jsonb;
  v_sale       jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items must be a non-empty array' USING ERRCODE = 'check_violation';
  END IF;

  IF p_tax IS NULL THEN
    p_tax := 0;
  ELSIF p_tax < 0 THEN
    RAISE EXCEPTION 'tax must not be negative' USING ERRCODE = 'check_violation';
  END IF;

  -- The API writes the actor from the verified token; refuse a caller-supplied
  -- one so a ticket cannot be attributed to somebody else.
  IF current_user IN ('anon', 'authenticated') AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'the sale must be attributed to the caller' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT currency INTO v_currency FROM public.businesses WHERE id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'business % does not exist', p_business_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Duplicate lines are legal on a ticket, but the stock check must see the sum.
  SELECT jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity))
    INTO v_grouped
  FROM (
    SELECT (item ->> 'product_id')::uuid AS product_id,
           SUM((item ->> 'quantity')::integer) AS quantity
    FROM jsonb_array_elements(p_items) AS item
    GROUP BY 1
  ) grouped;

  -- No row lock: `SELECT ... FOR UPDATE` is itself subject to the UPDATE policy
  -- under RLS, so a cashier (who may sell but not edit the catalogue) would see
  -- no row at all. The `products_stock_check` constraint is what actually stops
  -- two cashiers from selling the same last unit: the second UPDATE fails and
  -- takes its whole sale with it.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_grouped) LOOP
    SELECT * INTO v_product
    FROM public.products
    WHERE id = (v_item ->> 'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown product %', v_item ->> 'product_id' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NOT v_product.active THEN
      RAISE EXCEPTION 'product % is not available', v_product.name USING ERRCODE = 'check_violation';
    END IF;

    v_units := (v_item ->> 'quantity')::integer;
    IF v_units <= 0 THEN
      RAISE EXCEPTION 'quantity must be positive' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_product.is_service AND v_product.stock < v_units THEN
      RAISE EXCEPTION 'not enough stock for %', v_product.name USING ERRCODE = 'check_violation';
    END IF;

    v_line_total := v_product.price * v_units;
    v_subtotal := v_subtotal + v_line_total;
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product.id,
      'quantity', v_units,
      'unit_price', v_product.price,
      'total', v_line_total
    );
  END LOOP;

  INSERT INTO public.sales (business_id, user_id, currency, subtotal, tax, total, payment_method_id)
  VALUES (p_business_id, p_user_id, v_currency, v_subtotal, p_tax, v_subtotal + p_tax, p_payment_method_id)
  RETURNING id INTO v_sale_id;

  INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total)
  SELECT v_sale_id,
         (line ->> 'product_id')::uuid,
         (line ->> 'quantity')::integer,
         (line ->> 'unit_price')::numeric,
         (line ->> 'total')::numeric
  FROM jsonb_array_elements(v_lines) AS line;

  SELECT to_jsonb(s) || jsonb_build_object(
    'sale_items', (
      SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]'::jsonb)
      FROM public.sale_items i
      WHERE i.sale_id = v_sale_id
    )
  )
  INTO v_sale
  FROM public.sales s
  WHERE s.id = v_sale_id;

  RETURN v_sale;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale(uuid, uuid, jsonb, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, jsonb, numeric, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_sale(uuid, uuid, jsonb, numeric, uuid) IS
  'Creates a sale and its lines atomically, pricing from products and letting the item triggers move stock.';
