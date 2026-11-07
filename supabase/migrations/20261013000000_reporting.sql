-- 013: reporting
--
-- The ledger could answer "what happened" but not "what did it cost at the
-- time", and the API had no aggregate surface at all. This migration adds the
-- two facts reports need and four functions the API calls through PostgREST.
--
--   1  `sale_items.unit_cost` snapshots the product cost when the line is
--      written. `products.cost` is today's cost; using it retroactively makes a
--      profit report change when someone edits a product, which is not a report.
--      A trigger owns the column so a client cannot choose its own cost basis.
--
--   2  `businesses.timezone` makes day/week/month buckets follow the business
--      clock. Grouping in UTC would cut a Nicaraguan day at 18:00 local.
--
--   3  The report functions are SECURITY INVOKER (the default) on purpose: the
--      API calls them with the caller's JWT, so `current_business_id()` and the
--      RLS policies still decide what a role may read. Handing the API a
--      service-role aggregate would move that decision out of the database.
--
-- Money is reported in the business currency. `sales.currency` exists but no
-- exchange-rate table does, so sales in another currency are excluded rather
-- than silently added at par. When rates arrive, a normalisation step belongs
-- here, not in every caller.

-- Cost basis for a line, fixed at the moment the line is written.
ALTER TABLE public.sale_items
    ADD COLUMN unit_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0);

-- Existing lines: the best available estimate is the product's current cost.
-- Historical rows cannot be reconstructed better than this; new rows are exact.
UPDATE public.sale_items si
   SET unit_cost = COALESCE(p.cost, 0)
  FROM public.products p
 WHERE p.id = si.product_id;

-- A line's cost is derived, never supplied. The trigger runs on INSERT and on
-- UPDATE, so changing the product of a voided line moves the cost basis with it
-- and a client cannot forge `unit_cost` on either path.
CREATE OR REPLACE FUNCTION public.sale_items_snapshot_cost() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    product_cost numeric(12,2);
BEGIN
    SELECT p.cost INTO product_cost
      FROM public.products p
     WHERE p.id = NEW.product_id;

    NEW.unit_cost := COALESCE(product_cost, 0);
    RETURN NEW;
END;
$$;

CREATE TRIGGER sale_items_snapshot_cost
BEFORE INSERT OR UPDATE ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION public.sale_items_snapshot_cost();

-- Local calendar for daily/weekly/monthly buckets.
ALTER TABLE public.businesses
    ADD COLUMN timezone text NOT NULL DEFAULT 'America/Managua';

-- Report access patterns: completed sales by date, and line aggregation by
-- product inside a tenant. Both are narrower than the existing indexes.
CREATE INDEX idx_sales_completed_date
    ON public.sales (business_id, created_at DESC)
 WHERE status = 'completed';

CREATE INDEX idx_sale_items_business_product
    ON public.sale_items (business_id, product_id);

-- ---------------------------------------------------------------------------
-- Sales summary
-- ---------------------------------------------------------------------------
-- `p_from` and `p_to` are inclusive local dates. The range is converted to
-- [start, end) with `AT TIME ZONE`, so a report for 2026-11-01 covers exactly
-- that local day even though the server runs in UTC.
--
-- Voided sales are counted but never summed: the non-negotiable rule says a
-- cancelled sale stays recorded and out of the totals.
CREATE OR REPLACE FUNCTION public.report_sales_summary(
    p_business_id uuid,
    p_from        date,
    p_to          date,
    p_granularity text DEFAULT 'day'
) RETURNS TABLE (
    currency     text,
    bucket       date,
    sale_count   bigint,
    voided_count bigint,
    subtotal     numeric,
    tax          numeric,
    total        numeric
)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
    v_tz       text;
    v_currency text;
    start_ts   timestamptz;
    end_ts     timestamptz;
BEGIN
    IF p_granularity NOT IN ('day', 'week', 'month') THEN
        RAISE EXCEPTION 'granularity must be day, week or month'
            USING ERRCODE = '22023';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
        RAISE EXCEPTION 'from must be on or before to' USING ERRCODE = '22023';
    END IF;

    SELECT b.timezone, b.currency INTO v_tz, v_currency
      FROM public.businesses b
     WHERE b.id = p_business_id;
    IF v_tz IS NULL THEN RETURN; END IF;

    start_ts := p_from::timestamp AT TIME ZONE v_tz;
    end_ts   := (p_to + 1)::timestamp AT TIME ZONE v_tz;

    RETURN QUERY
    SELECT v_currency,
           date_trunc(p_granularity, s.created_at AT TIME ZONE v_tz)::date,
           count(*) FILTER (WHERE s.status = 'completed'),
           count(*) FILTER (WHERE s.status = 'voided'),
           COALESCE(sum(s.subtotal) FILTER (WHERE s.status = 'completed'), 0),
           COALESCE(sum(s.tax)      FILTER (WHERE s.status = 'completed'), 0),
           COALESCE(sum(s.total)    FILTER (WHERE s.status = 'completed'), 0)
      FROM public.sales s
     WHERE s.business_id = p_business_id
       AND s.created_at >= start_ts
       AND s.created_at <  end_ts
       AND s.currency = v_currency
     GROUP BY 2
     ORDER BY 2;
END;
$$;

-- ---------------------------------------------------------------------------
-- Inventory valuation
-- ---------------------------------------------------------------------------
-- Services are counted separately and never valued: they hold no stock, so
-- mixing them into `stock * cost` would invent inventory.
CREATE OR REPLACE FUNCTION public.report_inventory_valuation(
    p_business_id uuid
) RETURNS TABLE (
    currency        text,
    product_count   bigint,
    service_count   bigint,
    unit_count      bigint,
    cost_value      numeric,
    retail_value    numeric,
    low_stock_count bigint
)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
    v_currency text;
BEGIN
    SELECT b.currency INTO v_currency
      FROM public.businesses b
     WHERE b.id = p_business_id;
    IF v_currency IS NULL THEN RETURN; END IF;

    RETURN QUERY
    SELECT v_currency,
           count(*) FILTER (WHERE NOT p.is_service),
           count(*) FILTER (WHERE p.is_service),
           COALESCE(sum(p.stock) FILTER (WHERE NOT p.is_service), 0)::bigint,
           COALESCE(sum(p.stock * p.cost)  FILTER (WHERE NOT p.is_service), 0),
           COALESCE(sum(p.stock * p.price) FILTER (WHERE NOT p.is_service), 0),
           count(*) FILTER (WHERE NOT p.is_service AND p.stock <= p.low_stock_threshold)
      FROM public.products p
     WHERE p.business_id = p_business_id
       AND p.active;
END;
$$;

-- ---------------------------------------------------------------------------
-- Expense breakdown
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_expense_breakdown(
    p_business_id uuid,
    p_from        date,
    p_to          date
) RETURNS TABLE (
    category    text,
    entry_count bigint,
    total       numeric
)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
    v_tz     text;
    start_ts timestamptz;
    end_ts   timestamptz;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
        RAISE EXCEPTION 'from must be on or before to' USING ERRCODE = '22023';
    END IF;

    SELECT b.timezone INTO v_tz
      FROM public.businesses b
     WHERE b.id = p_business_id;
    IF v_tz IS NULL THEN RETURN; END IF;

    start_ts := p_from::timestamp AT TIME ZONE v_tz;
    end_ts   := (p_to + 1)::timestamp AT TIME ZONE v_tz;

    RETURN QUERY
    SELECT COALESCE(NULLIF(btrim(e.category), ''), 'Sin categoría'),
           count(*),
           COALESCE(sum(e.amount), 0)
      FROM public.expenses e
     WHERE e.business_id = p_business_id
       AND e.created_at >= start_ts
       AND e.created_at <  end_ts
     GROUP BY 1
     ORDER BY 3 DESC, 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- Net profit
-- ---------------------------------------------------------------------------
-- revenue - COGS - expenses. COGS uses the snapshot written with each line, so
-- a cost edit today cannot rewrite last month's profit. Expenses are every
-- recorded expense in the range, not only those tied to a sale.
CREATE OR REPLACE FUNCTION public.report_profit(
    p_business_id uuid,
    p_from        date,
    p_to          date
) RETURNS TABLE (
    currency     text,
    sale_count   bigint,
    revenue      numeric,
    tax          numeric,
    cogs         numeric,
    gross_profit numeric,
    expenses     numeric,
    net_profit   numeric
)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
    v_tz       text;
    v_currency text;
    start_ts   timestamptz;
    end_ts     timestamptz;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
        RAISE EXCEPTION 'from must be on or before to' USING ERRCODE = '22023';
    END IF;

    SELECT b.timezone, b.currency INTO v_tz, v_currency
      FROM public.businesses b
     WHERE b.id = p_business_id;
    IF v_tz IS NULL THEN RETURN; END IF;

    start_ts := p_from::timestamp AT TIME ZONE v_tz;
    end_ts   := (p_to + 1)::timestamp AT TIME ZONE v_tz;

    RETURN QUERY
    WITH scoped AS (
        SELECT s.id, s.total, s.tax
          FROM public.sales s
         WHERE s.business_id = p_business_id
           AND s.status = 'completed'
           AND s.created_at >= start_ts
           AND s.created_at <  end_ts
           AND s.currency = v_currency
    ),
    totals AS (
        SELECT count(*)                        AS sale_count,
               COALESCE(sum(scoped.total), 0)  AS revenue,
               COALESCE(sum(scoped.tax), 0)    AS tax
          FROM scoped
    ),
    cogs AS (
        SELECT COALESCE(sum(si.quantity * si.unit_cost), 0) AS cogs
          FROM public.sale_items si
          JOIN scoped s ON s.id = si.sale_id
    ),
    spent AS (
        SELECT COALESCE(sum(e.amount), 0) AS expenses
          FROM public.expenses e
         WHERE e.business_id = p_business_id
           AND e.created_at >= start_ts
           AND e.created_at <  end_ts
    )
    SELECT v_currency,
           t.sale_count,
           t.revenue,
           t.tax,
           c.cogs,
           t.revenue - c.cogs,
           s.expenses,
           t.revenue - c.cogs - s.expenses
      FROM totals t
      CROSS JOIN cogs c
      CROSS JOIN spent s;
END;
$$;

-- Functions are executable by PUBLIC by default. Reports are tenant data, so
-- only a signed-in role (and the server) may call them; the RLS policies inside
-- still decide which rows that role sees.
REVOKE ALL ON FUNCTION public.report_sales_summary(uuid, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_inventory_valuation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_expense_breakdown(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_profit(uuid, date, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.report_sales_summary(uuid, date, date, text)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_inventory_valuation(uuid)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_expense_breakdown(uuid, date, date)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_profit(uuid, date, date)
    TO authenticated, service_role;

COMMENT ON COLUMN public.sale_items.unit_cost IS
  'Product cost when the line was written; the COGS basis for reports.';
COMMENT ON COLUMN public.businesses.timezone IS
  'IANA zone used to bucket daily, weekly and monthly reports.';
COMMENT ON FUNCTION public.report_sales_summary(uuid, date, date, text) IS
  'Sales totals per local day/week/month; voided sales counted but not summed.';
COMMENT ON FUNCTION public.report_inventory_valuation(uuid) IS
  'Stock * cost and stock * price for active products; services excluded.';
COMMENT ON FUNCTION public.report_expense_breakdown(uuid, date, date) IS
  'Expense totals grouped by category for an inclusive local date range.';
COMMENT ON FUNCTION public.report_profit(uuid, date, date) IS
  'Revenue minus snapshot COGS minus expenses for an inclusive local date range.';
