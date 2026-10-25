-- 011: the API may append to the trail, through one function
--
-- Migration 010 made audit_log append-only and left the trigger as its only
-- writer. That covers every row change, which is most of what has to be
-- recorded. It cannot cover what changes no row: a login, a logout, a backup,
-- an export, or a sensitive request that was refused before it touched
-- anything. Those need an API-side write.
--
-- Handing the API an INSERT grant would undo 010: a grant is a writer that can
-- forge any entry it likes, with any action, actor and tenant. So the API gets
-- a function instead, and the function keeps every rule the trigger keeps:
--
--   1  It only INSERTs. There is no path from here to UPDATE, DELETE or
--      TRUNCATE, and the table grants from 010 are unchanged.
--
--   2  Values pass through audit_safe_values(), the same explicit allowlist the
--      trigger uses. A password, a PIN, a token or a nested payload is dropped
--      before it reaches the one table from which nothing can ever be deleted.
--
--   3  Metadata is allowlisted separately and its text is capped. The caller
--      cannot relabel itself as a trigger, cannot choose the actor type, and
--      cannot turn off the sensitive flag for a void, an adjustment or a delete.
--
--   4  EXECUTE goes to service_role only. anon and authenticated cannot call it,
--      so a browser cannot forge the record of what its user did.
--
-- The API writes an entry per sensitive request, alongside the trigger's row
-- entry. They answer different questions: the trigger records what changed, this
-- records who asked, from where, with what reason, and whether it succeeded.

CREATE OR REPLACE FUNCTION public.audit_append(
  p_action      text,
  p_entity_type text,
  p_business_id uuid   DEFAULT NULL,
  p_user_id     uuid   DEFAULT NULL,
  p_entity_id   uuid   DEFAULT NULL,
  p_old_values  jsonb  DEFAULT NULL,
  p_new_values  jsonb  DEFAULT NULL,
  p_metadata    jsonb  DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  new_id        uuid;
  safe_metadata jsonb;
BEGIN
  -- Both are used to build the action and to query the trail, so a malformed
  -- value is rejected rather than stored. `sales.void`, `stock.adjust`,
  -- `products.delete` and `auth.login` all match; free text does not.
  IF p_action IS NULL OR p_action !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'audit action must look like <entity>.<operation>, got %', p_action
      USING ERRCODE = '22023';
  END IF;
  IF p_entity_type IS NULL OR p_entity_type !~ '^[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'audit entity_type must be a table-like name, got %', p_entity_type
      USING ERRCODE = '22023';
  END IF;

  -- Explicit allowlist, scalar-only, same direction as audit_safe_values(): an
  -- unknown key is excluded because nobody named it, not because somebody
  -- remembered to deny it. Strings are capped so a caller cannot pad the one
  -- table that can never be pruned.
  SELECT COALESCE(jsonb_object_agg(
           key,
           CASE WHEN jsonb_typeof(value) = 'string'
                THEN to_jsonb(left(value #>> '{}', 1024))
                ELSE value END
         ), '{}'::jsonb)
    INTO safe_metadata
    FROM jsonb_each(COALESCE(p_metadata, '{}'::jsonb))
   WHERE key = ANY (ARRAY['operation','sensitive','request_id','method','path','status',
                          'duration_ms','ip','user_agent','outcome','reason','void_reason',
                          'adjustment','quantity_before','quantity_after'])
     AND jsonb_typeof(value) NOT IN ('object', 'array')
     -- A flag that arrives as the string "false" would be truthy to a reader.
     AND (key <> 'sensitive' OR jsonb_typeof(value) = 'boolean');

  -- source and actor_type are derived, never supplied: an API entry must not be
  -- able to present itself as a trigger entry, and the actor is the user id or
  -- there is no user.
  -- The sensitive flag can be raised by the caller but not lowered: a void, an
  -- adjustment and any delete are sensitive whatever the request said.
  safe_metadata := safe_metadata || jsonb_build_object(
    'source', 'api',
    'actor_type', CASE WHEN p_user_id IS NULL THEN 'system' ELSE 'user' END,
    'sensitive',
      COALESCE((safe_metadata ->> 'sensitive')::boolean, false)
      OR p_action IN ('sales.void', 'stock.adjust')
      OR p_action LIKE '%.delete');

  INSERT INTO public.audit_log(
    business_id, user_id, action, entity_type, entity_id, old_values, new_values, metadata)
  VALUES (
    p_business_id, p_user_id, p_action, p_entity_type, p_entity_id,
    public.audit_safe_values(p_old_values),
    public.audit_safe_values(p_new_values),
    safe_metadata)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

-- Functions are executable by PUBLIC by default, so the revoke is the grant's
-- other half. Without it any authenticated client could forge an entry.
REVOKE ALL ON FUNCTION public.audit_append(text, text, uuid, uuid, uuid, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.audit_append(text, text, uuid, uuid, uuid, jsonb, jsonb, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.audit_append(text, text, uuid, uuid, uuid, jsonb, jsonb, jsonb) IS
  'Appends one API-origin audit entry. SECURITY DEFINER; service_role only. Values are allowlisted by audit_safe_values().';
