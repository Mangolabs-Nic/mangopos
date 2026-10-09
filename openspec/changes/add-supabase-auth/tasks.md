# Tasks: Add Supabase Auth to NestJS API

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 260 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR (all work units fit within 800-line budget) |
| Delivery strategy | single-pr |
| Chain strategy | n/a (single PR) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: n/a (single-pr)
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Foundation: package.json + app.module.ts | Single PR | `npm install` + vitest run auth | `npm test` | package.json, app.module.ts |
| 2 | Auth module + services | Single PR | `npm test -- --run auth/services` | vitest run | auth/ folder, package.json |
| 3 | Guard + controller + specs | Single PR | `npm test -- --run auth/guard` | vitest run | auth/ folder |
| 4 | E2E test | Single PR | `vitest run --config ./vitest.config.e2e.ts` | vitest run | test user in Supabase |

## Phase 1: Foundation / Infrastructure

- [ ] 1.1 Add `@nestjs/jwt@^12`, `jwks-rsa@^3.2.0`, `pg@^8.23.0` to `apps/api/package.json` dependencies
- [ ] 1.2 Add `@supabase/supabase-js@^2.117.0`, `supertest`, `@types/supertest` to `apps/api/package.json` devDependencies
- [ ] 1.3 Modify `apps/api/src/app.module.ts`: import `AuthModule`; register `JwtAuthGuard` via `APP_GUARD` **before** `RolesGuard`
- [ ] 1.4 Run `npm install` in `apps/api` to install new dependencies

## Phase 2: Core Implementation

- [ ] 2.1 Create `apps/api/src/auth/public.decorator.ts`: export `IS_PUBLIC_KEY = 'isPublic'` and `Public()` decorator using `SetMetadata`
- [ ] 2.2 Create `apps/api/src/auth/jwt-verification.service.ts`: `JwtVerificationService` with `verify(token)` using `@nestjs/jwt` + `jwks-rsa`; issuer `SUPABASE_URL/auth/v1`, audience `authenticated`, expiry enforcement
- [ ] 2.3 Create `apps/api/src/auth/profiles.service.ts`: `ProfilesService` with `resolve(sub)` using `pg` client from `DATABASE_URL`; `SELECT role, business_id, active FROM profiles WHERE id = $1`
- [ ] 2.4 Create `apps/api/src/auth/auth.module.ts`: NestJS module exporting `JwtAuthGuard`, `ProfilesService`, `JwtVerificationService`

## Phase 3: Core Implementation (Guard & Controller)

- [ ] 3.1 Create `apps/api/src/auth/jwt-auth.guard.ts`: Global `CanActivate` guard; chains `JwtVerificationService.verify()` + `ProfilesService.resolve()`; on success sets `request.user = { sub, appRole, businessId }`; on failure throws `UnauthorizedException`; injects `Reflector` and checks `@Public()` metadata to skip
- [ ] 3.2 Create `apps/api/src/auth/auth.controller.ts`: `GET /auth/health` endpoint with `@Public()` decorator; returns `{ status: 'ok' }`

## Phase 4: Testing

- [ ] 4.1 Create `apps/api/src/auth/jwt-verification.service.spec.ts`: Unit tests — valid token (pass), expired token (fail), bad signature (fail), wrong issuer (fail), wrong audience (fail); JWKS stubbed
- [ ] 4.2 Create `apps/api/src/auth/profiles.service.spec.ts`: Unit tests — active profile resolves role/businessId; missing profile returns 401; inactive profile returns 401; pg.Client stubbed
- [ ] 4.3 Create `apps/api/src/auth/jwt-auth.guard.spec.ts`: Unit tests — valid flow populates request.user; missing token → 401; expired token → 401; unknown profile → 401; `@Public()` skip on health route; mock both services
- [ ] 4.4 Create `apps/api/test/auth.e2e-spec.ts`: E2E spec — valid token → 200 on protected route; no token → 401; `/auth/health` → 200 without token; test user created via `@supabase/supabase-js` Admin API in `beforeAll`; cleanup in `afterAll`

## Phase 5: Cleanup / Verification

- [ ] 5.1 Verify all `@Roles()` routes work with valid Supabase tokens and enforce role matrix
- [ ] 5.2 Verify requests without token → 401; invalid/expired token → 401; unknown profile → 401
- [ ] 5.3 Verify `/auth/health` returns 200 without authentication
- [ ] 5.4 Run full test suite: `npm test` (vitest) and `vitest run --config ./vitest.config.e2e.ts`
- [ ] 5.5 Confirm role changes take effect on next request without token refresh