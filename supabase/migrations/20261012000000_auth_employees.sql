-- 012: employees authenticate through Supabase Auth
--
-- The legacy desktop app kept a PIN in `empleados` and compared it locally. That
-- does not survive the move to a server: a PIN in a table is a password in a
-- table, and a session minted by the POS itself is a session nothing else can
-- verify. Identity moves to Supabase Auth, and this migration supplies the two
-- pieces GoTrue cannot know on its own:
--
--   1  A tenant handle. A 4-digit PIN is only unique inside one business, so the
--      login form needs a business slug; the PIN is then looked up inside it.
--
--   2  A blind index for the PIN. The PIN itself is never stored: the API sends
--      HMAC-SHA256(pin, PIN_PEPPER) and only that digest reaches the database,
--      in `employee_pins`, a table no client role can read. The digest is a
--      lookup key, not a password hash - the pepper lives in the API, so a
--      database dump alone does not let anyone enumerate PINs.
--
-- PIN login does not use the account password. The API resolves the digest to a
-- profile and exchanges a one-time magic link for a session, so an employee can
-- still have a real email/password and use Supabase's built-in recovery without
-- the two credentials drifting apart.
--
-- The last piece is the JWT. The custom access-token hook adds `user_id`,
-- `business_id`, `app_role` and `active` to every token. Row-level security
-- still resolves tenancy from `profiles` (always fresh, no token lifetime
-- window); the claims exist for the API and for clients that need to address a
-- tenant without a round trip.
--
-- Enabling the hook is a project setting, not a SQL one:
--   local  - supabase/config.toml, `[auth.hook.custom_access_token]`
--   hosted - Dashboard > Authentication > Hooks > Customize Access Token (JWT) Claims

-- A login handle, e.g. `mi-tienda-3f9a1c2b`. Unique and stable; not a secret.
ALTER TABLE public.businesses ADD COLUMN slug text;

-- Diacritics are folded rather than stripped: `Panadería Niño` must not become
-- `panader-a-ni-o`. The suffix comes from a random uuid, so two businesses with
-- the same name do not collide.
CREATE OR REPLACE FUNCTION public.slug_base(input text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT COALESCE(NULLIF(trim(both '-' FROM regexp_replace(
    translate(lower(COALESCE(input, '')),
              'áàäâãéèëêíìïîóòöôõúùüûñç',
              'aaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]+', '-', 'g')), ''), 'negocio');
$$;

UPDATE public.businesses
   SET slug = left(public.slug_base(name), 40) || '-'
            || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
 WHERE slug IS NULL;

CREATE OR REPLACE FUNCTION public.businesses_set_slug() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    NEW.slug := left(public.slug_base(NEW.name), 40) || '-'
             || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  END IF;
  NEW.slug := lower(btrim(NEW.slug));
  RETURN NEW;
END;
$$;

CREATE TRIGGER businesses_set_slug BEFORE INSERT ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.businesses_set_slug();

ALTER TABLE public.businesses ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX businesses_slug_key ON public.businesses (slug);

-- PIN blind index. Separate from profiles on purpose: profiles is readable by its
-- owner, and a digest readable by its owner is an offline oracle.
CREATE TABLE public.employee_pins (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    pin_lookup  text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT employee_pins_lookup_format CHECK (pin_lookup ~ '^[0-9a-f]{64}$')
);

-- Within one business two employees cannot share a PIN: the lookup would be
-- ambiguous, and one of them would be unable to log in.
CREATE UNIQUE INDEX employee_pins_business_pin_key
    ON public.employee_pins (business_id, pin_lookup);

ALTER TABLE public.employee_pins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.employee_pins FROM anon, authenticated, service_role;

-- The event is auditable; the digest is not. A dedicated trigger rather than the
-- generic row trigger, because audit_safe_values() would copy updated_at and the
-- ids and nothing else - this makes the omission explicit.
CREATE OR REPLACE FUNCTION public.audit_employee_pin_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.audit_log(
    business_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(NEW.business_id, OLD.business_id),
    auth.uid(),
    'profiles.pin_changed',
    'profiles',
    COALESCE(NEW.user_id, OLD.user_id),
    jsonb_build_object(
      'source', 'db_trigger',
      'operation', TG_OP,
      'actor_type', CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
      'sensitive', true));
  RETURN NULL;
END;
$$;

CREATE TRIGGER employee_pins_audit
AFTER INSERT OR UPDATE OR DELETE ON public.employee_pins
FOR EACH ROW EXECUTE FUNCTION public.audit_employee_pin_change();

-- Brute-force accounting. A PIN is 4-8 digits, so the only thing between it and
-- an oracle is a limit; it is kept per (business, address) so one office cannot
-- lock out another and a rotating address is the only way around it.
CREATE TABLE public.pin_attempts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    ip_hash      text NOT NULL,
    succeeded    boolean NOT NULL,
    attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pin_attempts_window ON public.pin_attempts (business_id, ip_hash, attempted_at DESC);

CREATE INDEX pin_attempts_retention ON public.pin_attempts (attempted_at);

ALTER TABLE public.pin_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pin_attempts FROM anon, authenticated, service_role;

-- Resolves a business slug plus a PIN digest to the account it belongs to, and
-- counts the attempt. Returns one of:
--   {status: ok, user_id, email}
--   {status: invalid}                       -- unknown slug, PIN, or inactive account
--   {status: locked, retry_after_seconds}   -- too many failures from this address
--
-- `invalid` is deliberately the same answer for every failure so the endpoint
-- cannot be used to enumerate businesses or employees.
CREATE OR REPLACE FUNCTION public.employee_pin_login(
    p_business_slug text,
    p_pin_lookup    text,
    p_ip_hash       text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    target_business uuid;
    target_profile  public.profiles;
    failures        integer;
    retry_after     integer;
BEGIN
    IF p_pin_lookup IS NULL OR p_pin_lookup !~ '^[0-9a-f]{64}$'
       OR p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    DELETE FROM public.pin_attempts WHERE attempted_at < now() - interval '7 days';

    SELECT id INTO target_business
      FROM public.businesses
     WHERE slug = lower(btrim(COALESCE(p_business_slug, '')));

    IF target_business IS NULL THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    SELECT count(*),
           GREATEST(1, ceil(extract(epoch FROM
               (min(attempted_at) + interval '15 minutes' - now()))))::int
      INTO failures, retry_after
      FROM public.pin_attempts
     WHERE business_id = target_business
       AND ip_hash = p_ip_hash
       AND NOT succeeded
       AND attempted_at > now() - interval '15 minutes';

    IF failures >= 10 THEN
        RETURN jsonb_build_object('status', 'locked',
                                  'retry_after_seconds', retry_after);
    END IF;

    SELECT p.* INTO target_profile
      FROM public.profiles p
      JOIN public.employee_pins ep ON ep.user_id = p.id
     WHERE p.business_id = target_business
       AND p.active
       AND ep.pin_lookup = p_pin_lookup
     FOR UPDATE OF p;

    -- An employee without an email cannot be given a session through the magic
    -- link exchange, and telling the caller that would leak which accounts exist.
    IF target_profile.id IS NULL OR target_profile.email IS NULL THEN
        INSERT INTO public.pin_attempts (business_id, ip_hash, succeeded)
        VALUES (target_business, p_ip_hash, false);
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    -- A success clears this address's failures for this business: the person is
    -- the employee, and leaving older failures to age out would lock them next.
    DELETE FROM public.pin_attempts
     WHERE business_id = target_business AND ip_hash = p_ip_hash AND NOT succeeded;

    INSERT INTO public.pin_attempts (business_id, ip_hash, succeeded)
    VALUES (target_business, p_ip_hash, true);

    RETURN jsonb_build_object(
        'status', 'ok', 'user_id', target_profile.id, 'email', target_profile.email);
END;
$$;

REVOKE ALL ON FUNCTION public.employee_pin_login(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.employee_pin_login(text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_pin_login(text, text, text) TO service_role;

-- The API stores the digest after it has computed it; the PIN never travels to
-- the database. A duplicate inside the business is a unique violation, which the
-- API reports as a conflict rather than silently picking one employee.
CREATE OR REPLACE FUNCTION public.set_employee_pin(
    p_user_id    uuid,
    p_pin_lookup text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    target_business uuid;
BEGIN
    IF p_pin_lookup IS NULL OR p_pin_lookup !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'pin lookup must be a SHA-256 hex digest' USING ERRCODE = '22023';
    END IF;

    SELECT business_id INTO target_business
      FROM public.profiles WHERE id = p_user_id;

    IF target_business IS NULL THEN
        RAISE EXCEPTION 'profile % does not exist', p_user_id USING ERRCODE = '23503';
    END IF;

    INSERT INTO public.employee_pins (user_id, business_id, pin_lookup)
    VALUES (p_user_id, target_business, p_pin_lookup)
    ON CONFLICT (user_id) DO UPDATE
        SET pin_lookup  = EXCLUDED.pin_lookup,
            business_id = EXCLUDED.business_id,
            updated_at  = now();
END;
$$;

REVOKE ALL ON FUNCTION public.set_employee_pin(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_employee_pin(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_employee_pin(uuid, text) TO service_role;

-- Claims for every access token. `user_id` is `sub` restated under the name the
-- plan uses; `business_id` is what a client addresses; `app_role` lets the API
-- authorise without a profiles read; `active` lets it refuse a deactivated
-- account before the request reaches a handler.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
    claims  jsonb;
    profile record;
BEGIN
    claims := COALESCE(event -> 'claims', '{}'::jsonb);

    IF event ->> 'user_id' IS NULL THEN
        RETURN event;
    END IF;

    SELECT id, business_id, role, active INTO profile
      FROM public.profiles
     WHERE id = (event ->> 'user_id')::uuid;

    IF profile.id IS NOT NULL THEN
        claims := jsonb_set(claims, '{user_id}',     to_jsonb(profile.id));
        claims := jsonb_set(claims, '{business_id}', to_jsonb(profile.business_id));
        claims := jsonb_set(claims, '{app_role}',    to_jsonb(profile.role));
        claims := jsonb_set(claims, '{active}',      to_jsonb(profile.active));
    END IF;

    RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;

-- The hook runs as GoTrue's role on a Supabase project. The function is SECURITY
-- DEFINER, so it reads profiles as its owner; the role only needs to call it.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
        GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
        GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
    END IF;
END $$;

-- An admin-created employee is marked in `raw_app_meta_data` (service-role only,
-- never the user-controlled `raw_user_meta_data`). Without this branch the
-- auth.users insert would provision a throwaway tenant for every employee and
-- leave it behind if provisioning then failed.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    target_business uuid;
BEGIN
    IF COALESCE(NEW.raw_app_meta_data ->> 'mangopos_provisioned', '') = 'true' THEN
        RETURN NEW;
    END IF;

    -- Self-service signup always provisions a NEW tenant. Joining an existing
    -- tenant goes through provision_user_for_business(), never client metadata.
    INSERT INTO public.businesses (name, currency)
    VALUES (
        COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'business_name', ''), 'Negocio nuevo'),
        COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'currency', ''), 'NIO')
    )
    RETURNING id INTO target_business;

    -- email is nullable now: phone and anonymous signups have none.
    INSERT INTO public.profiles (id, business_id, email, role)
    VALUES (NEW.id, target_business, NULLIF(NEW.email, ''), 'admin')
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Deactivation has to bite immediately, not at the next token refresh. These two
-- helpers are what every tenant policy resolves tenancy through, so an inactive
-- profile resolves to no tenant at all.
CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT business_id FROM public.profiles WHERE id = auth.uid() AND active
$$;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid() AND active
$$;

COMMENT ON FUNCTION public.employee_pin_login(text, text, text) IS
  'Resolves a business slug and a PIN blind index to an account; service_role only, rate limited per address.';
COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Adds user_id, business_id, app_role and active to Supabase Auth access tokens.';
