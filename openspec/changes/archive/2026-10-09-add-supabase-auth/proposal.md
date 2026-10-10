# Proposal: Add Supabase Auth to NestJS API

## Intent

The NestJS API (`apps/api`) has zero authentication — nothing populates `request.user`, so every `@Roles()` route returns 401. This change adds the minimum viable auth: a global guard that verifies the Supabase (GoTrue) JWT locally via JWKS, then hydrates `request.user = { sub, appRole, businessId }` from `public.profiles` so the existing `RolesGuard` works. Unblocks the 8 open `@Roles` tasks.

## Scope

### In Scope
- Global JWT verification guard using `@nestjs/jwt` + `jwks-rsa` against `SUPABASE_URL/auth/v1/.well-known/jwks.json` (issuer + `authenticated` audience + expiry)
- Per-request `profiles` lookup by `sub` to populate `request.user.appRole` and `businessId`
- Guard registered globally via `APP_GUARD` in `app.module.ts` (order: auth guard before `RolesGuard`)
- Unauthenticated/absent token → 401; unknown profile → 401
- Public `/auth/health` route for smoke checks
- Unit tests for guard: valid token, missing token, expired/bad signature, unknown profile (JWKS/JWT boundary stubbed)

### Out of Scope
- Custom JWT claims or `app_metadata.role` — `profiles.role` remains single source of truth
- RLS migration or switching off superuser connection — RLS stays defense-in-depth for later slice
- Seed/tenant user-provisioning system — test users created ad hoc via Supabase CLI/admin API
- Frontend, refresh-token handling, login UI
- Hosted Supabase / Railway — local Supabase only

## Capabilities

### New Capabilities
- `auth-jwt-verification`: Verifies Supabase access tokens via JWKS, extracts `sub`, enforces issuer/audience/expiry
- `auth-user-resolution`: Resolves `profiles.role` and `business_id` by `sub` on each authenticated request
- `auth-global-guard`: Global NestJS guard that chains verification + resolution, populates `request.user`

### Modified Capabilities
- None — existing `roles-guard` capability unchanged (already expects `request.user.appRole`)

## Approach

Use **Approach 1 from exploration**: JWKS verification + per-request `profiles.role` lookup.

Rationale: Unblocks `@Roles` tasks with minimum viable auth. No custom claims, no auth hooks, no token refresh logic — standard Supabase flow. Role changes take effect on next request (matches `RolesGuard` comment). Local Supabase exposes JWKS at `http://127.0.0.1:54321/auth/v1/.well-known/jwks.json`; `jwks-rsa` caches keys in-memory. API stays on superuser connection — RLS gap not closed in this slice.

Implementation:
1. Add deps: `@nestjs/jwt`, `jwks-rsa`, `@supabase/supabase-js` (admin client for tests)
2. Create `AuthModule` with `JwtAuthGuard` (global) that:
   - Extracts `Authorization: Bearer <token>`
   - Verifies via JWKS (issuer: `SUPABASE_URL/auth/v1`, audience: `authenticated`)
   - On success: `SELECT role, business_id FROM profiles WHERE id = <sub>` → `request.user = { appRole, businessId, sub }`
   - On failure: `throw UnauthorizedException`
3. Expose `/auth/health` (no guard) for connectivity checks

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/app.module.ts` | Modified | Register `AuthModule`, `JwtAuthGuard` via `APP_GUARD` before `RolesGuard` |
| `apps/api/src/main.ts` | Modified | Ensure global guard order if needed |
| `apps/api/src/auth/` | New | Auth module, guard, verification service, user resolution service |
| `apps/api/src/roles/roles.guard.ts` | No change | Already expects `request.user.appRole` — will work once populated |
| `package.json` (api) | Modified | Add `@nestjs/jwt`, `jwks-rsa`, `@supabase/supabase-js` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| JWKS endpoint unreachable in Docker network | Medium | Use `host.docker.internal` or service name for container-to-container |
| No seed data for dev/test | High | Document `supabase auth admin create-user` workflow; not blocking for guard logic |
| Key rotation breaks verification | Low | `jwks-rsa` auto-refetches JWKS on failure |
| RLS bypass via superuser connection | Medium | Keep `RolesGuard` global; add integration test verifying 401 without token |

## Rollback Plan

Revert `app.module.ts` to remove `AuthModule` and `APP_GUARD` registration. Delete `apps/api/src/auth/` folder. Remove added dependencies from `package.json`. No database changes to revert.

## Dependencies

- Local Supabase running (`supabase start`) exposing JWKS at `http://127.0.0.1:54321/auth/v1/.well-known/jwks.json`
- `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `.env` (already present)
- `@nestjs/jwt` ^11.x, `jwks-rsa` ^3.x, `@supabase/supabase-js` ^2.x

## Success Criteria

- [ ] All 8 `@Roles()` routes accept valid Supabase access tokens and enforce role matrix
- [ ] Requests without token → 401; invalid/expired token → 401; unknown profile → 401
- [ ] `/auth/health` returns 200 without authentication
- [ ] Unit tests pass: valid token, missing token, expired/bad signature, unknown profile
- [ ] Role change (demotion/promotion) takes effect on next request without token refresh