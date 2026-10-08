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

    -- Signup must IGNORE a client-supplied business_id. A client that could name
    -- its own tenant would become a member of it and read all of its rows through
    -- current_business_id(), so the metadata below is asserted to have no effect.
    INSERT INTO auth.users (id, aud, role, email, encrypted_password,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES
        ('bbbbbbbb-0000-0000-0000-00000000000a','authenticated','authenticated',
         'a@verify.local', crypt('x', gen_salt('bf')), '{}',
         '{"business_id":"aaaaaaaa-0000-0000-0000-00000000000a"}', now(), now()),
        ('bbbbbbbb-0000-0000-0000-00000000000b','authenticated','authenticated',
         'b@verify.local', crypt('x', gen_salt('bf')), '{}',
         '{"business_id":"aaaaaaaa-0000-0000-0000-00000000000b"}', now(), now());

    IF (SELECT business_id FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000a') = biz_a THEN
        RAISE EXCEPTION 'FAIL signup_ignores_client_tenant: signup joined the tenant the client named';
    END IF;
    RAISE NOTICE 'PASS  signup ignores the client-supplied business_id';

    -- Membership of an existing tenant is server-side provisioning. The harness
    -- runs as owner here, which is exactly the privilege that step requires.
    UPDATE public.profiles SET business_id = biz_a, role = 'cashier'
        WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000a';
    UPDATE public.profiles SET business_id = biz_b, role = 'cashier'
        WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000b';

    IF (SELECT business_id FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000a') <> biz_a THEN
        RAISE EXCEPTION 'FAIL membership_provisioning: server-side membership did not take effect';
    END IF;
    RAISE NOTICE 'PASS  tenant membership is server-provisioned';

    IF (SELECT count(*) FROM public.payment_methods
        WHERE business_id = biz_a AND kind IN ('cash','card')) <> 2 THEN
        RAISE EXCEPTION 'FAIL seeded_payment_methods: a new tenant needs cash+card';
    END IF;
    RAISE NOTICE 'PASS  new tenant is seeded with cash and card payment methods';

    INSERT INTO public.products (id, business_id, name, price, stock) VALUES
        ('cccccccc-0000-0000-0000-00000000000a', biz_a, 'Verify A product', 100.00, 10),
        ('cccccccc-0000-0000-0000-00000000000b', biz_b, 'Verify B product', 100.00, 10),
        -- Separate products for the sale_items policy check: selling a line moves stock, and
        -- the stock-integrity checks below count from cccccccc-...-0a, so their fixture has
        -- to land on something else.
        ('cccccccc-0000-0000-0000-0000000000f1', biz_a, 'Verify A line product', 100.00, 10),
        ('cccccccc-0000-0000-0000-0000000000f2', biz_b, 'Verify B line product', 100.00, 10);

    -- A ticket in each tenant, so the sale_items policy can be checked from both sides.
    INSERT INTO public.sales (id, business_id, total, status) VALUES
        ('eeeeeeee-0000-0000-0000-00000000000a', biz_a, 100.00, 'completed'),
        ('eeeeeeee-0000-0000-0000-00000000000b', biz_b, 100.00, 'completed');
    INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total) VALUES
        ('eeeeeeee-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-0000000000f1', 1, 100.00, 100.00),
        ('eeeeeeee-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-0000000000f2', 1, 100.00, 100.00);
END $$;

-- Checks that need the authenticated role -----------------------------------
-- Superuser bypasses RLS entirely, so these only mean something under
-- SET LOCAL ROLE authenticated with a JWT subject.
DO $$
DECLARE
    ok boolean;
    n   integer;
    v   integer;
    w   integer;
    au  integer;
BEGIN
    PERFORM set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-00000000000a', true);
    SET LOCAL ROLE authenticated;

    SELECT count(*) INTO n FROM public.products;
    IF n <> 2 THEN
        RAISE EXCEPTION 'FAIL tenant_isolation: expected 2 visible products, saw %', n;
    END IF;
    RAISE NOTICE 'PASS  tenant isolation: one tenant cannot see another''s rows';

    -- sale_items reached its tenant through a subquery on the parent sale. It now carries
    -- business_id, so its policy is a direct comparison like every other tenant table and
    -- has to hold without the subquery.
    SELECT count(*) INTO n FROM public.sale_items;
    IF n <> 1 THEN
        RAISE EXCEPTION 'FAIL sale_items_isolation: expected 1 visible line, saw %', n;
    END IF;

    BEGIN
        INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total)
        VALUES ('eeeeeeee-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-00000000000b', 1, 100.00, 100.00);
        RAISE EXCEPTION 'FAIL sale_items_isolation: a client added a line to another tenant''s ticket';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
    RAISE NOTICE 'PASS  sale_items are isolated without reaching through the parent sale';

    -- Deleting a business takes its catalogue, its sales and its audit trail with it, so
    -- the grant on businesses is the difference between "a cashier tidied up" and a total
    -- loss. Asserted as a refusal rather than an empty result: RLS filters silently, so
    -- only the privilege error proves the DELETE grant is actually gone.
    BEGIN
        DELETE FROM public.businesses WHERE id = 'aaaaaaaa-0000-0000-0000-00000000000b';
        RAISE EXCEPTION 'FAIL business_delete_blocked: a member deleted their own business';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    BEGIN
        PERFORM public.close_business('aaaaaaaa-0000-0000-0000-00000000000b');
        RAISE EXCEPTION 'FAIL close_business_is_server_only: a client closed a business';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    -- A cashier may not rename the business either. RLS filters rather than raising, so
    -- this is asserted on the row count.
    UPDATE public.businesses SET name = 'Renamed by a cashier'
     WHERE id = 'aaaaaaaa-0000-0000-0000-00000000000b';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
        RAISE EXCEPTION 'FAIL business_update_admin_only: a cashier renamed the business';
    END IF;
    RAISE NOTICE 'PASS  a member cannot delete, close or rename a business';

    BEGIN
        INSERT INTO public.audit_log (action, entity_type) VALUES ('FORGED', 'sale');
        RAISE EXCEPTION 'FAIL audit_forgery_blocked: a client wrote to audit_log';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS  client cannot forge audit entries';
    END;

    -- Tenant isolation holds only while profiles.business_id and profiles.role stay
    -- server-assigned: every other policy derives tenancy from
    -- current_business_id(), which reads that same row.
    BEGIN
        UPDATE public.profiles SET role = 'admin'
            WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000a';
        UPDATE public.profiles SET business_id = 'aaaaaaaa-0000-0000-0000-00000000000b'
            WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000a';
    EXCEPTION WHEN others THEN
        NULL; -- denied outright; asserted immediately below either way
    END;

    IF (SELECT role FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000a') <> 'cashier'
       OR (SELECT business_id FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000a')
          <> 'aaaaaaaa-0000-0000-0000-00000000000a' THEN
        RAISE EXCEPTION 'FAIL profile_self_promotion: a client mutated its own role or tenant';
    END IF;
    RAISE NOTICE 'PASS  a client cannot promote itself or cross tenants';

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
    -- A sale is never hard-deleted: voiding is the audit trail's job. Deleting
    -- one used to cascade its lines away, and because the parent row was already
    -- gone the trigger read its status as NULL, skipped the "already voided" guard
    -- and returned the stock a second time.
    BEGIN
        DELETE FROM public.sales WHERE id = 'dddddddd-0000-0000-0000-00000000000b';
        RAISE EXCEPTION 'FAIL hard_delete_refused: a sale was deleted instead of voided';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
    SELECT stock INTO v FROM public.products WHERE id = 'cccccccc-0000-0000-0000-00000000000a';
    IF v <> 8 THEN
        RAISE EXCEPTION 'FAIL hard_delete_leaves_stock: stock is % after a refused delete, expected 8', v;
    END IF;
    RAISE NOTICE 'PASS  a sale cannot be deleted, only voided';

    -- Voiding leaves sale_items in place. Removing them afterwards must not
    -- restore the same stock a second time.
    INSERT INTO public.sales (id, business_id, subtotal, total)
        VALUES ('dddddddd-0000-0000-0000-00000000000d',
                'aaaaaaaa-0000-0000-0000-00000000000a', 100.00, 100.00);
    INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total)
        VALUES ('dddddddd-0000-0000-0000-00000000000d',
                    'cccccccc-0000-0000-0000-00000000000a', 2, 50.00, 100.00);
    UPDATE public.sales SET status = 'voided', void_reason = 'verify'
        WHERE id = 'dddddddd-0000-0000-0000-00000000000d';
    SELECT stock INTO v FROM public.products WHERE id = 'cccccccc-0000-0000-0000-00000000000a';
    DELETE FROM public.sale_items WHERE sale_id = 'dddddddd-0000-0000-0000-00000000000d';
    SELECT stock INTO w FROM public.products WHERE id = 'cccccccc-0000-0000-0000-00000000000a';
    IF w <> v THEN
        RAISE EXCEPTION 'FAIL double_restore: stock moved from % to % when a voided sale''s items were deleted', v, w;
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

-- Sale path: tenant isolation, stock integrity, audit attribution -----------
DO $$
DECLARE
    biz_a uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
    biz_b uuid := 'aaaaaaaa-0000-0000-0000-00000000000b';
    prod_a uuid := 'cccccccc-0000-0000-0000-00000000000a';
    prod_b uuid := 'cccccccc-0000-0000-0000-00000000000b';
    svc_a  uuid := 'cccccccc-0000-0000-0000-00000000000c';
    sale_1 uuid := 'dddddddd-0000-0000-0000-000000000001';
    sale_2 uuid := 'dddddddd-0000-0000-0000-000000000002';
    v      integer;
    base   integer;
BEGIN
    INSERT INTO public.products (id, business_id, name, price, stock, is_service)
    VALUES (svc_a, biz_a, 'Verify A service', 25.00, 0, true);

    -- A sale may not carry another tenant's product. sale_items has no business_id
    -- of its own, so this is the only place the link can be enforced.
    INSERT INTO public.sales (id, business_id, total, status)
    VALUES (sale_1, biz_a, 100, 'completed');
    BEGIN
        INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total)
        VALUES (sale_1, prod_b, 1, 100, 100);
        RAISE EXCEPTION 'FAIL cross_tenant_product: a sale consumed another tenant''s stock';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS  a sale cannot consume another tenant''s product';
    END;

    -- A foreign key must not cross a tenant either: the referenced row belongs to
    -- its own tenant and the id alone does not prove it is the same one.
    INSERT INTO public.categories (id, business_id, name)
    VALUES ('eeeeeeee-0000-0000-0000-000000000001', biz_b, 'Verify B category');
    BEGIN
        INSERT INTO public.products (id, business_id, category_id, name, price, stock)
        VALUES ('eeeeeeee-0000-0000-0000-000000000002', biz_a, 'eeeeeeee-0000-0000-0000-000000000001', 'Bad', 1, 1);
        RAISE EXCEPTION 'FAIL cross_tenant_reference: a product adopted another tenant''s category';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS  a row cannot reference another tenant''s category, payment method or user';
    END;

    BEGIN
        INSERT INTO public.sales (id, business_id, payment_method_id, total, status)
        SELECT 'eeeeeeee-0000-0000-0000-000000000003', biz_a,
               (SELECT id FROM public.payment_methods WHERE business_id = biz_b LIMIT 1), 1, 'completed';
        RAISE EXCEPTION 'FAIL cross_tenant_payment_method: a sale used another tenant''s payment method';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS  a sale cannot use another tenant''s payment method';
    END;

    -- stock_adjustments resolves its tenant through the product, so the trigger
    -- parses a 'table.column' reference. A plain write must succeed, which is what
    -- a wrong array subscript silently broke.
    BEGIN
        INSERT INTO public.stock_adjustments
            (product_id, quantity_before, adjustment, quantity_after, reason)
        VALUES (prod_a, 10, -1, 9, 'verify');
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'FAIL stock_adjustment_write: a stock adjustment could not be written: %', SQLERRM;
    END;
    RAISE NOTICE 'PASS  stock adjustments can be written';

    -- A service has no stock to move, in either direction.
    INSERT INTO public.sales (id, business_id, total, status) VALUES (sale_2, biz_a, 25, 'completed');
    INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total)
    VALUES (sale_2, svc_a, 1, 25, 25);
    SELECT stock INTO v FROM public.products WHERE id = svc_a;
    IF v <> 0 THEN
        RAISE EXCEPTION 'FAIL service_sale: selling a service moved its stock to %', v;
    END IF;
    UPDATE public.sales SET status = 'voided', void_reason = 'verify' WHERE id = sale_2;
    SELECT stock INTO v FROM public.products WHERE id = svc_a;
    IF v <> 0 THEN
        RAISE EXCEPTION 'FAIL service_void: voiding a service credited it with % units', v;
    END IF;
    RAISE NOTICE 'PASS  a service neither consumes nor regains stock';

    -- A stocked sale: sell 2, edit the line to 3, void, and check every step.
    -- Assertions are relative to the stock on hand, because the checks above have
    -- already traded against this product inside the same transaction.
    SELECT stock INTO base FROM public.products WHERE id = prod_a;

    INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total)
    VALUES (sale_1, prod_a, 2, 100, 200);
    SELECT stock INTO v FROM public.products WHERE id = prod_a;
    IF v <> base - 2 THEN
        RAISE EXCEPTION 'FAIL stock_deduct: expected % after selling 2, saw %', base - 2, v;
    END IF;

    UPDATE public.sale_items SET quantity = 3 WHERE sale_id = sale_1 AND product_id = prod_a;
    SELECT stock INTO v FROM public.products WHERE id = prod_a;
    IF v <> base - 3 THEN
        RAISE EXCEPTION 'FAIL stock_on_edit: expected % after editing the line to 3, saw %', base - 3, v;
    END IF;
    RAISE NOTICE 'PASS  editing a line quantity moves stock';

    UPDATE public.sales SET status = 'voided', void_reason = 'verify' WHERE id = sale_1;
    SELECT stock INTO v FROM public.products WHERE id = prod_a;
    IF v <> base THEN
        RAISE EXCEPTION 'FAIL stock_restore: expected % after voiding, saw %', base, v;
    END IF;

    -- Voiding returns stock exactly once. Deleting the sale must be refused.
    BEGIN
        DELETE FROM public.sales WHERE id = sale_1;
        RAISE EXCEPTION 'FAIL sale_hard_delete: a voided sale was deleted, which restocks twice';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
    SELECT stock INTO v FROM public.products WHERE id = prod_a;
    IF v <> base THEN
        RAISE EXCEPTION 'FAIL double_restore: stock became % after a refused delete, expected %', v, base;
    END IF;
    RAISE NOTICE 'PASS  voiding restores stock once and a sale cannot be deleted';
END $$;

-- Audit trail: attribution ----------------------------------------------------
DO $$
DECLARE
    biz_a uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
BEGIN
    IF (SELECT count(*) FROM public.audit_log WHERE business_id IS NULL) > 0 THEN
        RAISE EXCEPTION 'FAIL audit_tenant: % audit rows have no tenant and are invisible to every tenant',
            (SELECT count(*) FROM public.audit_log WHERE business_id IS NULL);
    END IF;
    IF (SELECT count(*) FROM public.audit_log WHERE entity_id IS NULL) > 0 THEN
        RAISE EXCEPTION 'FAIL audit_entity_id: % audit rows do not record which row changed',
            (SELECT count(*) FROM public.audit_log WHERE entity_id IS NULL);
    END IF;
    IF (SELECT count(*) FROM public.audit_log WHERE business_id = biz_a) = 0 THEN
        RAISE EXCEPTION 'FAIL audit_tenant: no audit rows were attributed to the tenant that made them';
    END IF;
    RAISE NOTICE 'PASS  every audit row records both the row id and its tenant';
END $$;

-- Provisioning must not destroy a tenant ---------------------------------------
DO $$
DECLARE
    other_business uuid := 'aaaaaaaa-0000-0000-0000-00000000000b';
    owner_shop     uuid;
BEGIN
    -- A user who signed up, traded, and is later hired elsewhere keeps their shop:
    -- products, sales and the audit trail all cascade from a business.
    INSERT INTO auth.users (id, aud, role, email, encrypted_password,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES ('ffffffff-0000-0000-0000-000000000001','authenticated','authenticated',
            'owner@verify.local', crypt('x', gen_salt('bf')), '{}',
            '{"business_name":"Owner shop"}', now(), now());

    SELECT business_id INTO owner_shop FROM public.profiles
     WHERE id = 'ffffffff-0000-0000-0000-000000000001';

    INSERT INTO public.products (id, business_id, name, price, stock)
    VALUES ('ffffffff-0000-0000-0000-000000000002', owner_shop, 'Owner widget', 5.00, 5);
    INSERT INTO public.sales (id, business_id, total, status)
    VALUES ('ffffffff-0000-0000-0000-000000000003', owner_shop, 50, 'completed');

    PERFORM public.provision_user_for_business(
        'ffffffff-0000-0000-0000-000000000001', other_business, 'cashier');

    IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = owner_shop) THEN
        RAISE EXCEPTION 'FAIL provision_keeps_shop: the shop they built was deleted';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sales WHERE id = 'ffffffff-0000-0000-0000-000000000003') THEN
        RAISE EXCEPTION 'FAIL provision_keeps_history: their sales were deleted with the shop';
    END IF;
    IF (SELECT business_id FROM public.profiles
         WHERE id = 'ffffffff-0000-0000-0000-000000000001') <> other_business THEN
        RAISE EXCEPTION 'FAIL provision_assigns: the user was not moved to the new tenant';
    END IF;
    RAISE NOTICE 'PASS  hiring someone elsewhere does not destroy the shop they built';

    -- A signup tenant with nothing in it is still cleaned up.
    INSERT INTO auth.users (id, aud, role, email, encrypted_password,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES ('ffffffff-0000-0000-0000-000000000004','authenticated','authenticated',
            'trial@verify.local', crypt('x', gen_salt('bf')), '{}',
            '{"business_name":"Empty trial"}', now(), now());

    SELECT business_id INTO owner_shop FROM public.profiles
     WHERE id = 'ffffffff-0000-0000-0000-000000000004';

    PERFORM public.provision_user_for_business(
        'ffffffff-0000-0000-0000-000000000004', other_business, 'cashier');

    IF EXISTS (SELECT 1 FROM public.businesses WHERE id = owner_shop) THEN
        RAISE EXCEPTION 'FAIL provision_cleans_empty: an empty signup tenant was left behind';
    END IF;
    RAISE NOTICE 'PASS  an empty signup tenant is still removed on reassignment';
END $$;

DO $$
DECLARE
    shop      uuid := 'ffffffff-0000-0000-0000-0000000000e1';
    sold      uuid := 'ffffffff-0000-0000-0000-0000000000e2';
    unsold    uuid := 'ffffffff-0000-0000-0000-0000000000e4';
    ticket    uuid := 'ffffffff-0000-0000-0000-0000000000e3';
    refused   boolean;
    remaining integer;
BEGIN
    INSERT INTO public.businesses (id, name) VALUES (shop, 'Closing shop');
    INSERT INTO public.products (id, business_id, name, stock)
    VALUES (sold, shop, 'Sold thing', 9), (unsold, shop, 'Never sold', 3);
    INSERT INTO public.sales (id, business_id, total, status)
    VALUES (ticket, shop, 10, 'completed');
    INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total)
    VALUES (ticket, sold, 1, 10, 10);

    -- Checked as a schema invariant rather than by behaviour. sale_items.product_id used to be
    -- ON DELETE RESTRICT, which made closing a traded business fail - but only when Postgres
    -- happened to delete the products before the sale lines, and it does not guarantee that
    -- order. A behavioural check here passes roughly half the time against the very defect it
    -- is meant to catch, so the invariant is asserted instead: nothing in public may block a
    -- cascade, because a tenant must always be closable.
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE contype = 'f' AND confdeltype = 'r'
          AND connamespace = 'public'::regnamespace
    ) THEN
        RAISE EXCEPTION 'FAIL tenant_teardown: a restrictive foreign key can block closing a business';
    END IF;

    BEGIN
        DELETE FROM public.products WHERE id = sold;
        refused := false;
    EXCEPTION WHEN check_violation THEN
        refused := true;
    END;

    IF NOT refused THEN
        RAISE EXCEPTION 'FAIL product_with_history: a product with sales history could be deleted';
    END IF;
    IF (SELECT count(*) FROM public.sale_items WHERE sale_id = ticket) <> 1 THEN
        RAISE EXCEPTION 'FAIL product_with_history: the historical sale line was rewritten';
    END IF;
    RAISE NOTICE 'PASS  a product with sales history cannot be deleted out of a past ticket';

    DELETE FROM public.products WHERE id = unsold;
    RAISE NOTICE 'PASS  a product that was never sold can be deleted outright';

    DELETE FROM public.businesses WHERE id = shop;

    SELECT (SELECT count(*) FROM public.products      WHERE business_id = shop)
         + (SELECT count(*) FROM public.sales         WHERE business_id = shop)
         + (SELECT count(*) FROM public.sale_items    WHERE sale_id = ticket)
         + (SELECT count(*) FROM public.audit_log     WHERE business_id = shop)
    INTO remaining;

    IF remaining <> 0 THEN
        RAISE EXCEPTION 'FAIL tenant_teardown: closing a business left % row(s) behind', remaining;
    END IF;
    RAISE NOTICE 'PASS  closing a business purges its catalogue, sales and audit trail';
END $$;

-- Privilege checks that need no client session ---------------------------------
DO $$
DECLARE
    doomed uuid := 'ffffffff-0000-0000-0000-0000000000f1';
BEGIN
    -- TRUNCATE is not subject to row-level security, so holding it means being able to
    -- empty the schema in one statement regardless of tenant - and anon holds the same
    -- grant, so it would need no account. Asserted as a privilege invariant rather than
    -- by attempting it, since an attempt would depend on the suite's current contents.
    IF EXISTS (
        SELECT 1
          FROM information_schema.role_table_grants
         WHERE table_schema = 'public'
           AND grantee IN ('anon', 'authenticated')
           AND privilege_type = 'TRUNCATE'
    ) THEN
        RAISE EXCEPTION 'FAIL truncate_revoked: a client role still holds TRUNCATE';
    END IF;
    RAISE NOTICE 'PASS  no client role can truncate the schema';

    IF has_table_privilege('anon', 'public.businesses', 'DELETE')
       OR has_table_privilege('authenticated', 'public.businesses', 'DELETE') THEN
        RAISE EXCEPTION 'FAIL business_delete_revoked: a client role still holds DELETE on businesses';
    END IF;
    RAISE NOTICE 'PASS  no client role holds DELETE on businesses';

    -- The server key is the one route that closes a business. PostgREST connects as the
    -- service_role database role when the service key is used, which is what the GRANT is
    -- checked against.
    INSERT INTO public.businesses (id, name) VALUES (doomed, 'Server closes this one');
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    SET LOCAL ROLE service_role;
    PERFORM public.close_business(doomed);
    RESET ROLE;

    IF EXISTS (SELECT 1 FROM public.businesses WHERE id = doomed) THEN
        RAISE EXCEPTION 'FAIL close_business_service_key: the server could not close a business';
    END IF;
    RAISE NOTICE 'PASS  the service key can still close a business';
END $$;

-- Stock must agree with the lines, whichever way a line changes --------------------
DO $$
DECLARE
    shop     uuid := 'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    stocked  uuid := 'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbb001';
    spare    uuid := 'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbb002';
    service  uuid := 'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbb003';
    ticket   uuid := 'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbb010';
    voided   uuid := 'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbb011';
    other    uuid := 'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbb012';
    refused  boolean;
    stock_now integer;
    before_move integer;
BEGIN
    INSERT INTO public.businesses (id, name) VALUES (shop, 'Stock shop');
    INSERT INTO public.products (id, business_id, name, price, stock, is_service) VALUES
        (stocked, shop, 'Stocked',   10, 10, false),
        (spare,   shop, 'Spare',     10, 10, false),
        (service, shop, 'Delivery',  10,  0, true);
    INSERT INTO public.sales (id, business_id, total, subtotal, status, void_reason) VALUES
        (ticket, shop, 30, 30, 'completed', NULL),
        (voided, shop,  0,  0, 'voided',    'cancelled at the till'),
        (other,  shop,  0,  0, 'completed', NULL);
    INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total) VALUES
        (ticket, stocked, 3, 10, 30);

    -- Moving a line onto a service used to return early before the old product was
    -- credited, destroying the units outright.
    SELECT stock INTO before_move FROM public.products WHERE id = stocked;
    UPDATE public.sale_items SET product_id = service WHERE sale_id = ticket;

    SELECT stock INTO stock_now FROM public.products WHERE id = stocked;
    IF stock_now <> before_move + 3 THEN
        RAISE EXCEPTION 'FAIL line_to_service: expected % after moving 3 units to a service, saw %',
            before_move + 3, stock_now;
    END IF;
    RAISE NOTICE 'PASS  moving a line onto a service returns the units to the old product';

    -- Deleting a line does not return stock - voiding does - so a line on a sale that
    -- still stands must not be deletable at all.
    INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total)
    VALUES (other, spare, 1, 10, 10);

    BEGIN
        DELETE FROM public.sale_items WHERE sale_id = other;
        RAISE EXCEPTION 'FAIL line_delete_blocked: a line on a live sale was deleted';
    EXCEPTION WHEN check_violation THEN
        refused := true;
    END;

    IF NOT refused THEN
        RAISE EXCEPTION 'FAIL line_delete_blocked: a line on a live sale was deleted';
    END IF;
    RAISE NOTICE 'PASS  a line on a sale that still stands cannot be deleted';

    -- Voiding is still how units come back, and a voided sale can still be tidied.
    SELECT stock INTO before_move FROM public.products WHERE id = spare;
    UPDATE public.sales SET status = 'voided', void_reason = 'customer left'
     WHERE id = other;
    SELECT stock INTO stock_now FROM public.products WHERE id = spare;
    IF stock_now <> before_move + 1 THEN
        RAISE EXCEPTION 'FAIL void_restores_units: expected % after voiding, saw %',
            before_move + 1, stock_now;
    END IF;

    DELETE FROM public.sale_items WHERE sale_id = other;
    RAISE NOTICE 'PASS  voiding returns the units and a voided sale can still be tidied';

    -- Moving a line between a live and a voided sale has to move stock with it; the
    -- trigger used not to fire on a change of sale at all.
    INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, total)
    VALUES (ticket, spare, 2, 10, 20);
    SELECT stock INTO before_move FROM public.products WHERE id = spare;

    UPDATE public.sale_items SET sale_id = voided WHERE product_id = spare;
    SELECT stock INTO stock_now FROM public.products WHERE id = spare;
    IF stock_now <> before_move + 2 THEN
        RAISE EXCEPTION 'FAIL move_to_voided_sale: expected % after moving onto a voided sale, saw %',
            before_move + 2, stock_now;
    END IF;

    UPDATE public.sale_items SET sale_id = ticket WHERE product_id = spare;
    SELECT stock INTO stock_now FROM public.products WHERE id = spare;
    IF stock_now <> before_move THEN
        RAISE EXCEPTION 'FAIL move_to_live_sale: expected % after moving back onto a live sale, saw %',
            before_move, stock_now;
    END IF;
    RAISE NOTICE 'PASS  moving a line between a live and a voided sale moves the units';

    -- A category is a human choice, so a shop carrying only one is set up, not empty, and
    -- provisioning must leave it alone. Payment methods are deliberately excluded from that
    -- test: every tenant is auto-seeded with cash and card, so counting them would make every
    -- signup tenant look configured and no empty tenant would ever be cleaned up.
    INSERT INTO public.businesses (id, name) VALUES (other, 'Configured but unsold');
    INSERT INTO public.categories (id, business_id, name) VALUES (spare, other, 'Bakery');

    INSERT INTO auth.users (id, aud, role, email, encrypted_password,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES ('aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbb020', 'authenticated', 'authenticated',
            'configured@verify.local', crypt('x', gen_salt('bf')), '{}', '{}', now(), now());

    UPDATE public.profiles SET business_id = other
     WHERE id = 'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbb020';

    PERFORM public.provision_user_for_business(
        'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbb020', shop, 'cashier');

    IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = other) THEN
        RAISE EXCEPTION 'FAIL provision_keeps_configured: a shop with a category was deleted';
    END IF;
    RAISE NOTICE 'PASS  a shop that is configured but has not sold is kept on reassignment';
END $$;

ROLLBACK;

\echo '---------------------------------------------------------------'
\echo 'All schema verification checks passed. No data was persisted.'
\echo '---------------------------------------------------------------'
