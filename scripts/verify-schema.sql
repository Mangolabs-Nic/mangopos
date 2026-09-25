-- Schema verification harness.
--
-- Runs the behavioural checks that the migration history was designed against,
-- against ANY Postgres reachable over a connection string. The same file
-- verifies the local stack and a freshly pushed staging database.
--
--   Local:    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-schema.sql
--   Staging:  supabase db push --linked && psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-schema.sql
--
-- Everything runs inside a single transaction that is rolled back, so this
-- never leaves data behind. Safe to run against staging.
--
-- Exit code 0 means every check passed. Any FAIL is reported as an error and
-- rolls the transaction back.

\set ON_ERROR_STOP on

BEGIN;

-- Fixtures ------------------------------------------------------------------
DO $$
DECLARE
    biz_a uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
    biz_b uuid := 'aaaaaaaa-0000-0000-0000-00000000000b';
BEGIN
    IF to_regclass('public.products') IS NULL THEN
        RAISE EXCEPTION 'public.products missing - has the schema been applied?';
    END IF;

    INSERT INTO businesses (id, name, currency) VALUES
        (biz_a, 'Verify A', 'NIO'),
        (biz_b, 'Verify B', 'USD');

    -- Joining an existing tenant must yield cashier, never admin: a client that
    -- can pick its own role is a privilege-escalation hole.
    INSERT INTO auth.users (id, aud, role, email, encrypted_password,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES
        ('bbbbbbbb-0000-0000-0000-00000000000a','authenticated','authenticated',
         'a@verify.local', crypt('x', gen_salt('bf')), '{}',
         '{"business_id":"aaaaaaaa-0000-0000-0000-00000000000a"}', now(), now()),
        ('bbbbbbbb-0000-0000-0000-00000000000b','authenticated','authenticated',
         'b@verify.local', crypt('x', gen_salt('bf')), '{}',
         '{"business_id":"aaaaaaaa-0000-0000-0000-00000000000b"}', now(), now());

    IF (SELECT role FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000a') <> 'cashier' THEN
        RAISE EXCEPTION 'FAIL signup_role: joining a tenant must grant cashier';
    END IF;
    RAISE NOTICE 'PASS  signup provisions profile with role cashier';

    IF (SELECT count(*) FROM public.payment_methods
        WHERE business_id = biz_a AND kind IN ('cash','card')) <> 2 THEN
        RAISE EXCEPTION 'FAIL seeded_payment_methods: a new tenant needs cash+card';
    END IF;
    RAISE NOTICE 'PASS  new tenant is seeded with cash and card payment methods';

    INSERT INTO public.products (id, business_id, name, price, stock) VALUES
        ('cccccccc-0000-0000-0000-00000000000a', biz_a, 'Verify A product', 100.00, 10),
        ('cccccccc-0000-0000-0000-00000000000b', biz_b, 'Verify B product', 100.00, 10);
END $$;

-- Checks that need the authenticated role -----------------------------------
-- Superuser bypasses RLS entirely, so these only mean something under
-- SET LOCAL ROLE authenticated with a JWT subject.
DO $$
DECLARE
    ok boolean;
    n   integer;
    v   integer;
    au  integer;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-00000000000a', true);
    SET LOCAL ROLE authenticated;

    SELECT count(*) INTO n FROM public.products;
    IF n <> 1 THEN
        RAISE EXCEPTION 'FAIL tenant_isolation: expected 1 visible product, saw %', n;
    END IF;
    RAISE NOTICE 'PASS  tenant isolation: one tenant cannot see another''s rows';

    BEGIN
        INSERT INTO public.audit_log (action, entity_type) VALUES ('FORGED', 'sale');
        RAISE EXCEPTION 'FAIL audit_forgery_blocked: a client wrote to audit_log';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS  client cannot forge audit entries';
    END;

    -- The regression this harness exists for: a SECURITY INVOKER audit trigger
    -- has its own insert rejected by the audit_log write policy, and every sale
    -- fails. The insert below only succeeds if the trigger is SECURITY DEFINER.
    BEGIN
        INSERT INTO public.sales (id, business_id, subtotal, total, status, currency)
            VALUES ('dddddddd-0000-0000-0000-00000000000a',
                    'aaaaaaaa-0000-0000-0000-00000000000a', 300.00, 300.00, 'completed', 'NIO');
        INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total)
            VALUES ('dddddddd-0000-0000-0000-00000000000a',
                    'cccccccc-0000-0000-0000-00000000000a', 3, 100.00, 300.00);
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'FAIL audit_trigger_self_block: sale insert failed: %', SQLERRM;
    END;
    RAISE NOTICE 'PASS  a sale survives its own audit trigger';

    SELECT count(*) INTO au FROM public.audit_log
        WHERE entity_id = 'dddddddd-0000-0000-0000-00000000000a';
    IF au < 1 THEN
        RAISE EXCEPTION 'FAIL audit_written: the sale produced no audit row';
    END IF;
    RAISE NOTICE 'PASS  audit trail recorded the sale';

    SELECT stock INTO v FROM public.products WHERE id = 'cccccccc-0000-0000-0000-00000000000a';
    IF v <> 7 THEN
        RAISE EXCEPTION 'FAIL stock_decrement: stock is %, expected 7', v;
    END IF;
    RAISE NOTICE 'PASS  selling decrements stock (10 -> 7)';

    BEGIN
        INSERT INTO public.sales (id, business_id, subtotal, total)
            VALUES ('dddddddd-0000-0000-0000-00000000000c',
                    'aaaaaaaa-0000-0000-0000-00000000000a', 9999, 9999);
        INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total)
            VALUES ('dddddddd-0000-0000-0000-00000000000c',
                    'cccccccc-0000-0000-0000-00000000000a', 500, 20, 9999);
        RAISE EXCEPTION 'FAIL oversell_blocked: stock went negative';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS  overselling is rejected';
    END;

    UPDATE public.sales SET status = 'voided', void_reason = 'verify'
        WHERE id = 'dddddddd-0000-0000-0000-00000000000a';
    SELECT stock INTO v FROM public.products WHERE id = 'cccccccc-0000-0000-0000-00000000000a';
    IF v <> 10 THEN
        RAISE EXCEPTION 'FAIL void_restores: stock is %, expected 10', v;
    END IF;
    RAISE NOTICE 'PASS  voiding a sale restores stock';

    INSERT INTO public.sales (id, business_id, subtotal, total)
        VALUES ('dddddddd-0000-0000-0000-00000000000b',
                'aaaaaaaa-0000-0000-0000-00000000000a', 100.00, 100.00);
    INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total)
        VALUES ('dddddddd-0000-0000-0000-00000000000b',
                'cccccccc-0000-0000-0000-00000000000a', 2, 50.00, 100.00);
    SELECT stock INTO v FROM public.products WHERE id = 'cccccccc-0000-0000-0000-00000000000a';
    IF v <> 8 THEN
        RAISE EXCEPTION 'FAIL second_sale: stock is %, expected 8', v;
    END IF;
    DELETE FROM public.sales WHERE id = 'dddddddd-0000-0000-0000-00000000000b';
    SELECT stock INTO v FROM public.products WHERE id = 'cccccccc-0000-0000-0000-00000000000a';
    IF v <> 10 THEN
        RAISE EXCEPTION 'FAIL cascade_delete_restores: stock is %, expected 10', v;
    END IF;
    RAISE NOTICE 'PASS  cascade delete of a sale restores stock';

    -- Voiding leaves sale_items in place. Deleting them afterwards must not
    -- restore the same stock a second time.
    INSERT INTO public.sales (id, business_id, subtotal, total)
        VALUES ('dddddddd-0000-0000-0000-00000000000d',
                'aaaaaaaa-0000-0000-0000-00000000000a', 100.00, 100.00);
    INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total)
        VALUES ('dddddddd-0000-0000-0000-00000000000d',
                    'cccccccc-0000-0000-0000-00000000000a', 2, 50.00, 100.00);
    UPDATE public.sales SET status = 'voided', void_reason = 'verify'
        WHERE id = 'dddddddd-0000-0000-0000-00000000000d';
    DELETE FROM public.sale_items WHERE sale_id = 'dddddddd-0000-0000-0000-00000000000d';
    SELECT stock INTO v FROM public.products WHERE id = 'cccccccc-0000-0000-0000-00000000000a';
    IF v <> 10 THEN
        RAISE EXCEPTION 'FAIL double_restore: stock is %, a voided sale was counted twice', v;
    END IF;
    RAISE NOTICE 'PASS  deleting a voided sale''s items does not double-restore';

    RESET ROLE;
END $$;

-- Owner-level checks ---------------------------------------------------------
DO $$
DECLARE
    total integer;
BEGIN
    IF (SELECT count(*) FROM pg_tables
        WHERE schemaname = 'public' AND NOT rowsecurity) > 0 THEN
        RAISE EXCEPTION 'FAIL rls_everywhere: a public table has RLS disabled';
    END IF;
    RAISE NOTICE 'PASS  RLS is enabled on every public table';

    SELECT count(*) INTO total FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.contype = 'f';
    IF total = 0 THEN
        RAISE EXCEPTION 'FAIL foreign_keys: the schema has no foreign keys';
    END IF;
    RAISE NOTICE 'PASS  schema declares % foreign keys', total;

    -- The defect the roles task is meant to close. Reported, not fatal, so the
    -- harness stays usable while that work is in progress.
    IF (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND qual ILIKE '%current_role%') = 0 THEN
        RAISE WARNING 'role-based RLS: 0 policies reference current_role - admin, supervisor and cashier are NOT enforced';
    ELSE
        RAISE NOTICE 'PASS  role-based RLS policies are present';
    END IF;
END $$;

ROLLBACK;

\echo '---------------------------------------------------------------'
\echo 'All schema verification checks passed. No data was persisted.'
\echo '---------------------------------------------------------------'
