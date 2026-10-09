-- 005: who is allowed to destroy a tenant
--
-- Three problems, all of them privilege rather than correctness.
--
-- 1. businesses_own was FOR ALL USING (id = current_business_id()), and Supabase grants
--    DELETE to every signed-in role. Deleting a business removes its catalogue, its sales
--    and its audit trail, so the lowest-privileged member of a tenant - a cashier - could
--    erase the whole business with one statement. 3c34855 made that delete reliable by
--    removing the restrictive foreign key that used to fail it by accident; it left the
--    grant that made it possible in place. The same FOR ALL let a cashier rename the
--    business or change its currency.
--
-- 2. TRUNCATE was granted to anon and authenticated on every public table, and RLS does
--    not govern TRUNCATE at all. Any caller could truncate the entire schema in a single
--    statement, across every tenant, bypassing tenant isolation completely - and `anon`
--    holds the same grant, so this needed no account and no session at all.
--
-- 3. Supabase's default privileges for tables created by `postgres` are
--    arwdDxtm for anon and authenticated, so every table added later inherited TRUNCATE
--    as well. Revoked from the default too, otherwise the next migration reopens this.
--
-- Closing a business stays possible, but only from the server: close_business() checks
-- auth.role() and is executable only by service_role.

-- =============================================================================
-- businesses: readable by members, writable by admins, never deleted by a client
-- =============================================================================

DROP POLICY IF EXISTS businesses_own ON public.businesses;
DROP POLICY IF EXISTS businesses_select_own ON public.businesses;
DROP POLICY IF EXISTS businesses_update_admin ON public.businesses;

CREATE POLICY businesses_select_own ON public.businesses
    FOR SELECT USING (id = public.current_business_id());

-- WITH CHECK as well as USING: without it an admin could move their own row onto
-- another tenant's id and hand the update to a business they do not belong to.
CREATE POLICY businesses_update_admin ON public.businesses
    FOR UPDATE USING (id = public.current_business_id() AND public.current_role() = 'admin')
                WITH CHECK (id = public.current_business_id());

REVOKE DELETE ON public.businesses FROM anon, authenticated;

-- Provisioning creates the tenant through provision_user_for_business, which is
-- SECURITY DEFINER, so clients have no need to insert one either.
REVOKE INSERT ON public.businesses FROM anon, authenticated;

-- =============================================================================
-- TRUNCATE, everywhere
-- =============================================================================

DO $$
DECLARE
    target regclass;
BEGIN
    FOR target IN
        SELECT c.oid::regclass
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
    LOOP
        EXECUTE format('REVOKE TRUNCATE ON public.%s FROM anon, authenticated', target);
    END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

-- =============================================================================
-- Closing a business, server side only
-- =============================================================================

CREATE OR REPLACE FUNCTION public.close_business(target uuid)
RETURNS void AS $$
BEGIN
    -- auth.role() reads the JWT role claim, so this holds for the service key the API
    -- runs on and cannot be satisfied by a user session.
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'close_business requires the service key'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    DELETE FROM public.businesses WHERE id = target;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.close_business(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_business(uuid) TO service_role;