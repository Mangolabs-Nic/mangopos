## Exploration: add-supabase-auth

### Current State

**API (`apps/api` — NestJS 12)**
- Zero authentication today. `RolesGuard` is registered globally via `APP_GUARD` in `app.module.ts:18` but only activates on routes with `@Roles(...)` decorator.
- `RolesGuard` (roles.guard.ts) expects `request.user.appRole` — a mirror of `public.profiles.role` (`admin` | `supervisor` | `cashier`), **not** the Supabase JWT `role` claim (which is always `authenticated`).
- No middleware, guard, or interceptor populates `request.user`. Any `@Roles` route currently returns `401 Unauthorized` (roles.guard.ts:51-53).
- Dependencies: only `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `reflect-metadata`, `rxjs`. No JWT, Supabase client, or validation libraries installed.

**Database (local Supabase `supabase_db_mangopos` on 54322)**
- 8 migrations, no seed file (`supabase/seed.sql` missing).
- `profiles` table (initial_schema.sql:27-35): `id` FK→`auth.users`, `business_id`, `email`, `role` CHECK(`admin`,`supervisor`,`cashier`), `active`.
- `handle_new_user()` trigger (schema_fixes.sql:109-137): on `auth.users` INSERT, creates a new `business` + `profile` with `role='admin'`. Self-service signup always provisions a **new tenant**; joining an existing tenant is server-side via `provision_user_for_business()` (tenant_isolation_and_stock.sql:41-80).
- Role matrix (role_matrix.sql:25-35): `can_manage()` = `current_role() IN ('supervisor','admin')`, `is_admin()` = `current_role() = 'admin'`. `current_role()` reads `profiles.role` via SECURITY DEFINER function (initial_schema.sql:167-175).
- 35 RLS policies exist, all permissive with empty `polroles` because the API connects as superuser (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) — **RLS is bypassed app-side**.

**Supabase Local Config (`supabase/config.toml`)**
- `auth.enabled = true`, `jwt_expiry = 3600` (1 hour), `enable_refresh_token_rotation = true`.
- `site_url = "http://127.0.0.1:3000"`, `additional_redirect_urls = ["https://127.0.0.1:3000"]`.
- Local JWT signing key is generated on each `supabase start`; available via `supabase status` → `JWT_SECRET` (not exposed in config.toml).

**Environment (`.env`)**
```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_KEY=sb_secret_...
```

### Affected Areas

- `apps/api/src/main.ts` — bootstrap; ideal place to register a global auth guard/middleware.
- `apps/api/src/app.module.ts` — DI providers; add JWT verification service, Supabase client.
- `apps/api/src/roles/roles.guard.ts` — already expects `request.user.appRole`; will work once auth populates it.
- `apps/api/src/common/access-control.ts` — CORS/diagnostics; may need to allow auth endpoints.
- `supabase/config.toml` — `auth` section; may need `jwt_issuer` for local verification.
- New files: auth module, JWT verification guard, Supabase client provider, user resolution service.

### Approaches

#### 1. **JWKS Verification + Per-Request `profiles.role` Lookup** (Recommended for MVP)
- Use `@nestjs/jwt` with `jwks-rsa` to fetch JWKS from `SUPABASE_URL/auth/v1/jwks` (or local equivalent).
- Verify JWT signature, expiry, issuer, audience on every request.
- After verification, extract `sub` (user UUID), query `profiles` for `role` and `business_id`, attach to `request.user`.
- **Pros**: Always fresh role (demotion takes effect next request), no custom claims to manage, works with standard Supabase flow.
- **Cons**: Extra DB round-trip per authenticated request (~1-2ms on local), requires JWKS endpoint reachable.
- **Effort**: Medium (new deps, guard, service, ~150 LOC).

#### 2. **Shared Secret (`SUPABASE_JWT_SECRET`) + Embedded `app_metadata.role`**
- Use `SUPABASE_JWT_SECRET` from local Supabase (available via `supabase status` or dashboard) with `@nestjs/jwt` `secret` option.
- At sign-in (via custom access token hook or client-side), embed `app_metadata: { role: profiles.role }` into JWT.
- Verify locally with symmetric key — no network call. Read `app_metadata.role` from decoded token.
- **Pros**: Zero DB round-trip, fastest verification, works offline.
- **Cons**: Role staleness until token refresh (1h default), requires custom access token hook or client cooperation to embed claim, `user_metadata` is user-editable — **must use `app_metadata`** (supabase skill security checklist).
- **Effort**: Medium-High (needs Supabase auth hook or client-side logic, token refresh handling).

#### 3. **Supabase `getUser()` via `@supabase/supabase-js` (Server-Side)**
- Install `@supabase/supabase-js`, create server client with `SUPABASE_SERVICE_KEY`.
- On each request, extract Bearer token, call `supabase.auth.getUser(token)` — validates against GoTrue and returns user + `app_metadata`.
- Attach `app_metadata.role` (or query `profiles` as fallback) to `request.user`.
- **Pros**: Single library, handles rotation/refresh automatically, official Supabase pattern.
- **Cons**: Network call to GoTrue (54321) per request, adds latency, service key bypasses RLS — but we only read auth, not data.
- **Effort**: Low-Medium (one dep, thin wrapper, ~80 LOC).

#### 4. **Hybrid: JWKS for Verification, `profiles` for Role (with Caching)**
- Same as Approach 1 but cache `profiles.role` per user for TTL (e.g., 5 min) using in-memory LRU or Redis.
- Cache invalidated on role change (admin updates `profiles` → emit event / call cache invalidate).
- **Pros**: Freshness within bounds, reduces DB load.
- **Cons**: Added complexity (cache, invalidation), over-engineering for local MVP.
- **Effort**: High.

### Recommendation

**First Slice: Approach 1 (JWKS + per-request `profiles` lookup)**

Rationale:
- Unblocks the 8 `@Roles` tasks with the **minimum viable auth**: a global guard that verifies the Supabase-issued JWT and hydrates `request.user.appRole` from `profiles.role`.
- No custom claims, no auth hooks, no token refresh logic — standard Supabase flow.
- Role changes (demotion/promotion) take effect on the **next request** — matches the `RolesGuard` comment: "a demotion takes effect on the next request" (roles.guard.ts:16).
- Local Supabase exposes JWKS at `http://127.0.0.1:54321/auth/v1/jwks` (verified in Supabase source). `jwks-rsa` caches keys in-memory automatically.
- Keep the API on the superuser connection for now — **do not close the RLS gap in this slice**. The `RolesGuard` is the authorization gate; RLS remains a defense-in-depth layer for when a frontend exists. Proportionate for local MVP.

**Implementation Sketch (first slice only):**
1. Add deps: `@nestjs/jwt`, `jwks-rsa`, `@supabase/supabase-js` (for admin user creation in tests).
2. Create `AuthModule` with `JwtAuthGuard` (global, registered after `RolesGuard` or merged) that:
   - Extracts `Authorization: Bearer <token>`
   - Verifies via JWKS (issuer: `SUPABASE_URL/auth/v1`, audience: `authenticated`)
   - On success: `SELECT role, business_id FROM profiles WHERE id = <sub>` → `request.user = { appRole, businessId, sub }`
   - On failure: `throw UnauthorizedException`
3. Expose `/auth/health` (no guard) for connectivity checks.
4. Document local dev: `supabase start` → `supabase status` → copy `JWT_SECRET` if needed, but JWKS works without it.

### Risks

- **JWKS endpoint not reachable in isolated networks** — local Supabase runs in Docker; API runs on host. `SUPABASE_URL=http://127.0.0.1:54321` works on host; in container use `host.docker.internal` or service name.
- **No seed data for dev/test** — `supabase/seed.sql` missing. Need a script to create test users via `supabase auth admin create-user` or SQL `INSERT INTO auth.users` + trigger. Blocking for manual testing.
- **Key rotation** — Supabase rotates JWT keys periodically. `jwks-rsa` handles this by re-fetching JWKS on verification failure. Local Supabase may not rotate often, but the mechanism is sound.
- **RLS bypass** — API uses superuser. If a bug lets a request through without `RolesGuard`, data is exposed. Mitigation: keep `RolesGuard` global, add integration test that a request without token gets 401.
- **Refresh token handling** — Not in scope for API-side verification. Frontend (when built) handles refresh; API only verifies access tokens.

### Ready for Proposal

**Yes.** The exploration is complete. The orchestrator should tell the user:

> The first slice is clear: add a NestJS global auth guard that verifies the Supabase GoTrue JWT via JWKS (local: `http://127.0.0.1:54321/auth/v1/jwks`), then hydrates `request.user.appRole` from `profiles.role` on each request. This unblocks all 8 `@Roles` tasks. Do not embed roles in JWT, do not switch off the superuser connection, and do not build a seed system yet — those are follow-up slices. Proceed to **Proposal** with this scope.