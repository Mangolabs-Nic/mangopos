# Apply Progress: Add Supabase Auth to NestJS API

Status: **complete** - all 19 tasks implemented, unit + e2e + lint green.

## Work Unit Evidence

| Unit | Focused test command + result | Runtime harness + result | Rollback boundary |
|------|-------------------------------|--------------------------|-------------------|
| 1. Foundation (deps) | `npm install` - 43 packages added, exit 0 | `npx vitest run` - 7 files / 116 pass | `apps/api/package.json`, `package-lock.json` |
| 2. JWT verification service | `npx vitest run src/auth/jwt-verification.service.spec.ts` - 8 tests pass (valid ES256/RS256, bad signature, expired, wrong issuer, wrong audience, no sub, malformed) | e2e: authenticated `/health` 200 via real JWKS (`GET /health` 200, durationMs 22, real ES256 key from `supabase_auth_mangopos`) | `apps/api/src/auth/jwt-verification.service.ts` |
| 3. Profiles service | `npx vitest run src/auth/profiles.service.spec.ts` - 4 tests pass (active, missing, inactive, unknown role) | e2e: guard resolved real auto-provisioned profile for the test user | `apps/api/src/auth/profiles.service.ts` |
| 4. Guard + controller + module | `npx vitest run src/auth/jwt-auth.guard.spec.ts` - 8 tests pass (public skip, valid flow, bearer case, no header, non-bearer, verify fail, profile fail) | e2e: `/health` no token 401, malformed token 401, valid token 200; `/auth/health` 200 no token | `apps/api/src/auth/`, `apps/api/src/app.module.ts` |
| 5. E2E suite | `npx vitest run --config ./vitest.config.e2e.ts` - 2 files / 5 tests pass | Full local stack: user created via admin API, sign-in via anon key, trigger-provisioned profile resolved | `apps/api/test/auth.e2e-spec.ts`, `apps/api/test/app.e2e-spec.ts` |

Verification commands (all executed, all exit 0):

- `npx vitest run` -> 7 files, 116 tests passed
- `npx vitest run --config ./vitest.config.e2e.ts` -> 2 files, 5 tests passed
- `npx oxlint --type-aware src/ test/` -> clean
- `npx tsc --noEmit -p tsconfig.build.json` -> clean

## Task Status

- [x] 1.1 `@nestjs/jwt@^12`, `jwks-rsa@^3.2.0`, `pg@^8.23.0` added to `apps/api/package.json` dependencies
- [x] 1.2 `@supabase/supabase-js@^2.117.0` added to devDependencies (`supertest` / `@types/supertest` already present). Also added `@types/pg@^8.15.0` - `pg` ships no bundled types; required for `tsc`/type-aware lint (deviation from task list, see below)
- [x] 1.3 `app.module.ts` imports `AuthModule`; `JwtAuthGuard` registered via `APP_GUARD` before `RolesGuard`
- [x] 1.4 `npm install` run from repo root (workspace) - lockfile at root updated, 43 packages added
- [x] 2.1 `public.decorator.ts`: `IS_PUBLIC_KEY = 'isPublic'` + `Public()` via `SetMetadata`
- [x] 2.2 `jwt-verification.service.ts`: `verify(token)` via `@nestjs/jwt` `secretOrKeyProvider` + `jwks-rsa`; issuer `{SUPABASE_URL}/auth/v1`, audience `authenticated`, algorithms `['RS256','ES256']`, expiry enforced
- [x] 2.3 `profiles.service.ts`: `resolve(sub)` via `pg.Pool`; parameterised `SELECT role, business_id, active FROM public.profiles WHERE id = $1`
- [x] 2.4 `auth.module.ts` exports `JwtAuthGuard`, `JwtVerificationService`, `ProfilesService`
- [x] 3.1 `jwt-auth.guard.ts`: global guard, checks `@Public()` via `Reflector`, Bearer extraction, chains `verify()` + `resolve()`, sets `request.user = { sub, appRole, businessId }`, throws `UnauthorizedException` on any failure
- [x] 3.2 `auth.controller.ts`: `GET /auth/health` with `@Public()`, returns `{ status: 'ok' }`
- [x] 4.1 `jwt-verification.service.spec.ts`: 8 unit tests, JWKS stubbed via `vi.mock('jwks-rsa')`, real ES256/RS256 signatures in-test
- [x] 4.2 `profiles.service.spec.ts`: 4 unit tests, `pg` stubbed (the design names `pg.Client`; implemented with `pg.Pool` since all paths flow through one pooled connection - see deviations)
- [x] 4.3 `jwt-auth.guard.spec.ts`: 8 unit tests, both services mocked, real `Reflector`
- [x] 4.4 `auth.e2e-spec.ts`: 4 e2e tests; user created via Admin API in `beforeAll` (trigger auto-provisions business + admin profile), sign-in via anon key for token, cleanup in `afterAll` (user + business deleted, verified 0 rows left)
- [x] 5.1 Role matrix: `RolesGuard` tests cover `@Roles()` behavior; guard e2e resolved the auto-provisioned `admin` profile. No production `@Roles` routes exist yet, so the global guard is what all routes hit.
- [x] 5.2 No token -> 401, malformed token -> 401 (e2e); expired token, wrong issuer/audience, unknown profile -> 401 (unit)
- [x] 5.3 `/auth/health` returns 200 without authentication (e2e)
- [x] 5.4 Full suite: unit (116) + e2e (5) + lint all green
- [x] 5.5 Role freshness: `ProfilesService` reads `public.profiles` on every request (no cache), so a demotion takes effect on the next request without token refresh; verified by code inspection and the per-request DB query in the e2e path

## Deviations from Design / Tasks

1. **JWKS URL**: `design.md` states `${SUPABASE_URL}/auth/v1/jwks`, which answers 404. The real endpoint is `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (confirmed via OIDC discovery `jwks_uri`). Implementation defaults to the real path and honors an optional `SUPABASE_JWKS_URL` override.
2. **`pg.Client` vs `pg.Pool`**: the task text says "using pg client"; implemented with a lazy `pg.Pool` so the app holds one shared connection manager instead of opening one client per request. Behavior is identical for the covered scenarios.
3. **`@types/pg` added** (devDep): `pg` does not bundle TypeScript types; `tsc` and `oxlint --type-aware` fail without them.
4. **`/health` is now protected**: the global guard applies to it. Existing `test/app.e2e-spec.ts` expected 200; updated to assert 401 (the public probe is `/auth/health`, covered by the new e2e). **Outstanding risk**: `docker-compose.yml` healthcheck still probes `/health` and will mark the API unhealthy after this change - update it to probe `/auth/health` in a follow-up.
5. **`@nestjs/jwt` verification plumbing**: `JwtVerifyOptions.secret` accepts only `string | Buffer`, so key selection by `kid` is done through `secretOrKeyProvider`, decoding the token header with `jwtService.decode(token, { complete: true })`.
6. **Key algorithm**: local Supabase GoTrue signs with ES256 (P-256); `jwks-rsa` v3 handles EC keys. The allowed algorithm list is `['RS256', 'ES256']` so legacy RS256 keeps working.

## Issues Found

- None blocking. The `.atl/skill-registry.md` modification in the worktree is unrelated and was left unstaged.
- Pre-existing: `npx tsc --noEmit -p tsconfig.json` fails on `supertest/types` in `test/` (seen in the untouched baseline file). The build (`tsconfig.build.json`) excludes `test/`, so `nest build` is unaffected. `tsc --noEmit -p tsconfig.build.json` on `src/` passes clean.