# Design: Add Supabase Auth to NestJS API

## Technical Approach

Implement a global NestJS guard (`JwtAuthGuard`) that verifies Supabase-issued JWTs via JWKS (`jwks-rsa`), then resolves `profiles.role` and `business_id` by `sub` on every request using a direct Postgres client (`pg`). The guard registers via `APP_GUARD` **before** the existing `RolesGuard`, populates `request.user = { sub, appRole, businessId }`, and exposes `/auth/health` as a public route via a `@Public()` metadata decorator. No custom claims, no RLS migration, no seed system — local Supabase only.

Maps to:
- `auth-jwt-verification` spec: Bearer extraction, JWKS verification, expiry/issuer/audience enforcement
- `auth-user-resolution` spec: per-request `profiles` lookup, fresh role read, 401 on missing/inactive profile
- `auth-global-guard` spec: global guard ordering, 401/403 split, public health endpoint

## Architecture Decisions

### Decision: Database Access for Profile Lookup

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `@supabase/supabase-js` (REST via PostgREST) | Adds HTTP hop; RLS may filter rows since API uses superuser connection | ❌ Rejected |
| `pg` (node-postgres) | Direct TCP to 54322; uses existing `DATABASE_URL`; no extra infra; minimal deps | ✅ Chosen |
| Custom `DatabaseModule` with abstraction | Over-engineering for single lookup; YAGNI | ❌ Rejected |

**Rationale**: The API already connects as superuser via `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`. A direct `pg` client reuses this connection string, avoids the PostgREST/RLS layer, and adds only one dependency (~200 LOC for a thin wrapper). The `profiles` lookup is a single `SELECT role, business_id, active FROM profiles WHERE id = $1` — no ORM needed.

### Decision: JWT Verification Library & Versions

| Dependency | Version Range | Why |
|------------|---------------|-----|
| `@nestjs/jwt` | `^12.0.0` | Latest major (12.0.2). Peer deps accept `@nestjs/common`: `^8 || ^9 || ^10 || ^11 || ^12`, so it matches the repo's NestJS `^12.0.1`. |
| `jwks-rsa` | `^3.2.0` | Handles JWKS caching + auto-refetch on key rotation, on all Node `>=20`. (`jwks-rsa@4` requires Node `^20.19.0 || ^22.12.0 || >=23`, stricter than the repo's declared `engines.node: >=20`.) |
| `pg` | `^8.23.0` | node-postgres; pure-JS path works on Windows. |
| `@supabase/supabase-js` | `^2.117.0` | **Test-only** (devDependency). Used to create test users via Admin API in e2e tests. Not used in production guard path. |

**Rationale**: `@nestjs/jwt@12` is the major that matches NestJS 12 — its peer range was confirmed with `npm view @nestjs/jwt peerDependencies` (`@nestjs/common: ^8 || ^9 || ^10 || ^11 || ^12`). No `@nestjs/config` is added — the API already reads `process.env` directly via `process.loadEnvFile()` in `main.ts`.

### Decision: Guard Ordering & Public Route Exclusion

- **Order**: In `app.module.ts`, register `JwtAuthGuard` via `APP_GUARD` **before** `RolesGuard`. Nest executes guards in provider registration order.
- **Public route**: `@Public()` decorator sets metadata key `IS_PUBLIC_KEY`. `JwtAuthGuard` injects `Reflector`, checks for this metadata on handler/class, and returns `true` (skip) if present.
- **401 vs 403 split**: `JwtAuthGuard` throws `UnauthorizedException` (401) for missing/invalid/expired token or unknown/inactive profile. `RolesGuard` only runs after auth passes and throws `ForbiddenException` (403) for insufficient `appRole`. The spec scenarios confirm this cannot invert.

### Decision: JWKS Endpoint & Docker Reachability

- **Local**: `SUPABASE_URL=http://127.0.0.1:54321` → JWKS at `http://127.0.0.1:54321/auth/v1/.well-known/jwks.json` (works on host; confirmed via OIDC discovery `jwks_uri`).
- **Container**: If API runs in Docker, `127.0.0.1` won't reach host Supabase. **Mitigation**: Document `SUPABASE_JWKS_URL` override (e.g. `http://host.docker.internal:54321/auth/v1/.well-known/jwks.json`). Guard reads `process.env.SUPABASE_JWKS_URL ?? `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json``.

## Data Flow

```
Request
  │
  ├─► JwtAuthGuard (global, runs first)
  │     │
  │     ├─ Extract Bearer token from Authorization header
  │     ├─ @Public() metadata? → skip → next guard
  │     ├─ Verify via @nestjs/jwt + jwks-rsa
  │     │     • JWKS from SUPABASE_JWKS_URL (cached)
  │     │     • issuer: ${SUPABASE_URL}/auth/v1
  │     │     • audience: authenticated
  │     │     • expiry: exp claim
  │     ├─ On failure → throw UnauthorizedException (401)
  │     │
  │     └─ On success: extract sub
  │           │
  │           └─► ProfilesService (pg client)
  │                 │
  │                 └─ SELECT role, business_id, active FROM profiles WHERE id = $1
  │                       │
  │                       ├─ No row / active=false → throw UnauthorizedException (401)
  │                       └─ Row found → request.user = { sub, appRole: role, businessId }
  │
  ├─► RolesGuard (global, runs second)
  │     │
  │     ├─ @Roles() metadata? → no → pass
  │     ├─ Read request.user.appRole
  │     ├─ No user → UnauthorizedException (401) — defense in depth
  │     ├─ Role mismatch → ForbiddenException (403)
  │     └─ Match → pass
  │
  └─► Route handler executes with request.user populated
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/package.json` | Modify | Add `@nestjs/jwt@^11`, `jwks-rsa@^3`, `pg@^8` to dependencies; `@supabase/supabase-js@^2` to devDependencies |
| `apps/api/src/app.module.ts` | Modify | Import `AuthModule`; register `JwtAuthGuard` via `APP_GUARD` before `RolesGuard` |
| `apps/api/src/auth/auth.module.ts` | Create | NestJS module exporting `JwtAuthGuard`, `ProfilesService`, `JwtVerificationService` |
| `apps/api/src/auth/jwt-verification.service.ts` | Create | Wraps `@nestjs/jwt` + `jwks-rsa`; `verify(token): Promise<{ sub: string }>` |
| `apps/api/src/auth/profiles.service.ts` | Create | `pg` client from `DATABASE_URL`; `resolve(sub): Promise<{ appRole, businessId }>` |
| `apps/api/src/auth/jwt-auth.guard.ts` | Create | Global `CanActivate`; chains verification + resolution; populates `request.user` |
| `apps/api/src/auth/public.decorator.ts` | Create | `@Public()` decorator + `IS_PUBLIC_KEY` constant for Reflector |
| `apps/api/src/auth/auth.controller.ts` | Create | `GET /auth/health` with `@Public()`; returns `{ status: 'ok' }` |
| `apps/api/src/auth/jwt-verification.service.spec.ts` | Create | Unit tests: valid token, expired, bad signature, wrong issuer/audience (JWKS stubbed) |
| `apps/api/src/auth/profiles.service.spec.ts` | Create | Unit tests: active profile, missing profile, inactive profile (pg stubbed) |
| `apps/api/src/auth/jwt-auth.guard.spec.ts` | Create | Unit tests: full guard flow with mocked services; `@Public()` skip |
| `apps/api/test/auth.e2e-spec.ts` | Create | e2e smoke: valid token → 200, no token → 401, `/auth/health` → 200 |

## Interfaces / Contracts

```typescript
// apps/api/src/auth/public.decorator.ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// apps/api/src/auth/jwt-verification.service.ts
export interface JwtPayload {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  // ... other standard claims
}
export interface JwtVerificationService {
  verify(token: string): Promise<{ sub: string }>;
}

// apps/api/src/auth/profiles.service.ts
export interface ProfileRow {
  role: 'admin' | 'supervisor' | 'cashier';
  business_id: string;
  active: boolean;
}
export interface ProfilesService {
  resolve(sub: string): Promise<{ appRole: Role; businessId: string }>;
}

// apps/api/src/auth/jwt-auth.guard.ts (request extension)
declare global {
  namespace Express {
    interface Request {
      user?: { sub: string; appRole: Role; businessId: string };
    }
  }
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `JwtVerificationService.verify()` | Stub `jwks-rsa`/`@nestjs/jwt` internals; test valid, expired, bad sig, wrong iss/aud |
| Unit | `ProfilesService.resolve()` | Stub `pg.Client`; test active profile, missing row, inactive row |
| Unit | `JwtAuthGuard.canActivate()` | Mock both services; test valid flow, 401 paths, `@Public()` skip |
| Integration | Full guard chain + RolesGuard | `@nestjs/testing` module with real guards, mocked services; verify 401→403 ordering |
| E2E | `/auth/health` public, protected route with valid token | `supertest` against compiled app; requires local Supabase running; test user created via `supabase auth admin create-user` + SQL profile insert |

**Test data**: No `seed.sql` exists. E2E tests create a test user via `@supabase/supabase-js` Admin API (`supabase.auth.admin.createUser`) then insert a `profiles` row via `pg` in `beforeAll`. Cleanup in `afterAll`.

> Note: `supertest` is currently **missing** from `apps/api` devDependencies (the existing `apps/api/test/app.e2e-spec.ts` already imports it, which is why a bare `tsc` on the test tree currently errors). Tasks MUST add `supertest` (and `@types/supertest`) as devDependencies for the new e2e spec to compile.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary changed. This change adds an authentication guard and database lookup only.

## Migration / Rollout

No migration required. No database schema changes. Rollback: revert `app.module.ts` (remove `AuthModule` import and `APP_GUARD` registration), delete `apps/api/src/auth/` folder, remove added dependencies from `package.json`.

## Open Questions

- [x] ~~Confirm `@nestjs/jwt@11` works with NestJS 12~~ — **resolved**: use `@nestjs/jwt@^12` (peer range verified via `npm view`; latest 12.0.2).
- [ ] Decide whether `pg` client uses a pool or single client (pool preferred for production readiness; single client acceptable for local MVP)
- [ ] Document `SUPABASE_JWKS_URL` override for Docker in README or `.env.example`