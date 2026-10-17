# Archive Report: add-supabase-auth

**Change ID**: add-supabase-auth
**Date**: 2026-10-09
**Status**: Archived · **Archived to**: `openspec/changes/archive/2026-10-09-add-supabase-auth/` · **Verdict**: PASS · **Remediation**: not required (`remediationState required=false`)

---

## Goal

Add the minimum viable authentication to the NestJS API (`apps/api`): a global guard that verifies Supabase (GoTrue) access tokens locally via JWKS (`jwks-rsa` + `@nestjs/jwt`), resolves `profiles.role` and `business_id` per request via a direct `pg` connection, and populates `request.user = { sub, appRole, businessId }` so the existing `RolesGuard` works (unblocks the 8 `@Roles` tasks). Public `/auth/health` route stays unauthenticated for smoke checks.

## Requirements Closure

Delta specs define 10 requirements / 19 scenarios (8 `auth-jwt-verification` + 5 `auth-user-resolution` + 6 `auth-global-guard`). All closed as **COMPLIANT** at verification:

| Domain | Requirements | Scenarios | Closure |
|--------|--------------|-----------|---------|
| `auth-jwt-verification` | Bearer Token Extraction, JWKS Signature Verification, Token Expiry Enforcement, Issuer and Audience Enforcement | 8 | ✅ Verifier `sha256:5253b9838a1bfdbb2a62e32c92a3728b40e931f4fa088123fb9aa5fe6cd4f7a6` |
| `auth-user-resolution` | Profile Resolution by sub, Missing or Inactive Profile Rejected, Role Read Fresh Per Request | 5 | ✅ Same verifier |
| `auth-global-guard` | Global Guard Populates request.user, Guard Ordering Before RolesGuard, Public Health Route Excludes Auth | 6 | ✅ Same verifier |

**Scenario counts reconciled at close**: 19/19 (8+5+6). The delta specs and `verify-report.md` agree. Note: Engram observation #872 (verify, 2026-10-09 16:14) preview reads "20 scenarios" — stale wording; the ranked sources (launch prompt and verify-report) both state 19/19.

**Source-of-truth note**: The delta specs were synced to main specs (mechanical `cp` → `diff -r` → `mv`, empty readback for all three) in the follow-up closure run. Main specs now exist at:
- `openspec/specs/auth-global-guard/spec.md` (created — full spec copy of the delta)
- `openspec/specs/auth-jwt-verification/spec.md` (created — full spec copy of the delta, with the reconciled JWKS path)
- `openspec/specs/auth-user-resolution/spec.md` (created — full spec copy of the delta)

No pre-existing main spec existed for any auth domain (only `turborepo-orchestration`), so each delta spec was copied as a full spec and no ADDED/MODIFIED/REMOVED/RENAMED merge was required.

## Task Closure

`tasks.md` (the persisted task artifact) shows **19/19 implementation tasks complete** (`[x]` across Phases 1–5). No unchecked tasks remain. Task Completion Gate: **PASS**.

## Implementation Summary

- **Dependencies** (`apps/api/package.json`): `@nestjs/jwt@^12`, `jwks-rsa@^3`, `pg@^8` (deps); `@supabase/supabase-js@^2`, `supertest`, `@types/supertest`, `@types/pg@^8` (devDeps — `@types/pg` added because `pg` ships no bundled types; documented deviation).
- **`apps/api/src/auth/`**: `auth.module.ts`, `jwt-verification.service.ts` (JWKS verify via `secretOrKeyProvider` + `jwtService.decode(..., { complete: true })` key selection by `kid`; issuer `${SUPABASE_URL}/auth/v1`, audience `authenticated`, algorithms `['RS256','ES256']`, expiry via `@nestjs/jwt`), `profiles.service.ts` (lazy `pg.Pool`; parameterized `SELECT role, business_id, active FROM public.profiles WHERE id = $1`), `jwt-auth.guard.ts` (global `APP_GUARD`, `@Public()` skip via `Reflector`, Bearer regex `/^Bearer (\S+)$/i`, 401 on missing/invalid/expired/unknown-profile), `public.decorator.ts`, `auth.controller.ts` (`GET /auth/health` → `{ status: 'ok' }`).
- **`apps/api/src/app.module.ts`**: `JwtAuthGuard` registered via `APP_GUARD` **before** `RolesGuard`; `/auth/health` public, `/health` now protected (defense-in-depth 401).
- **Tests**: 3 unit spec files (8 + 4 + 8) + e2e `auth.e2e-spec.ts` (4 tests) and updated `app.e2e-spec.ts`.
- **Container healthcheck**: `docker-compose.yml` probes `/auth/health` (commit `b1df561` — confirmed in repo history; kept as documented).

## Verification / Test Results

| Metric | Value |
|--------|-------|
| Verdict | **PASS** (10/10 requirements, 19/19 scenarios) |
| Evidence revision | `sha256:5253b9838a1bfdbb2a62e32c92a3728b40e931f4fa088123fb9aa5fe6cd4f7a6` (final, per launch prompt) |
| Unit tests | 116 passed / 0 failed (`npx vitest run`, 7 files) |
| E2E tests | 5 passed / 0 failed (`npx vitest run --config ./vitest.config.e2e.ts`, 2 files, requires local Supabase) |
| Type-check | `npx tsc --noEmit -p tsconfig.build.json` clean |
| DB verify | `db:verify` clean |
| Lint | `npx oxlint --type-aware src/ test/` clean |
| CRITICAL findings | None |
| Remediation | Not required — first-run pass (`remediationState required=false`) |

**Hash discrepancy recorded (transparency)**: `verify-report.md` front-matter still carries the snapshot `evidence_revision sha256:47cc95a3...` captured when the report was written; the launch prompt provides the final revision `sha256:5253b98...`, which outranks the intermediate snapshot and is recorded above as the close-state value.

**Post-verify reconciliation applied at close**: the JWKS path literal was stale in several change artifacts (design/proposal/exploration/delta-spec said `/auth/v1/jwks`, which answers 404). The implementation correctly uses `/auth/v1/.well-known/jwks.json` (OIDC discovery `jwks_uri`). All change artifacts that stated the wrong path as current truth were reconciled in-place to the implemented endpoint. The historical deviation narrative in `apply-progress.md` and `verify-report.md` was intentionally preserved (audit trail).

## Artifacts

Archived change folder: `openspec/changes/archive/2026-10-09-add-supabase-auth/` (moved via mechanical `git mv`, verified by empty `diff -r` readback — see phase result)

| Artifact | Path | State |
|----------|------|-------|
| Exploration | `openspec/changes/archive/2026-10-09-add-supabase-auth/exploration.md` | Reconciled (JWKS path) |
| Proposal | `openspec/changes/archive/2026-10-09-add-supabase-auth/proposal.md` | Reconciled (JWKS path) |
| Delta spec `auth-jwt-verification` | `openspec/changes/archive/2026-10-09-add-supabase-auth/specs/auth-jwt-verification/spec.md` | Reconciled (JWKS path) |
| Delta spec `auth-user-resolution` | `openspec/changes/archive/2026-10-09-add-supabase-auth/specs/auth-user-resolution/spec.md` | Unchanged |
| Delta spec `auth-global-guard` | `openspec/changes/archive/2026-10-09-add-supabase-auth/specs/auth-global-guard/spec.md` | Unchanged |
| Design | `openspec/changes/archive/2026-10-09-add-supabase-auth/design.md` | Reconciled (JWKS path) |
| Tasks | `openspec/changes/archive/2026-10-09-add-supabase-auth/tasks.md` | 19/19 complete, 0 unchecked |
| Apply progress | `openspec/changes/archive/2026-10-09-add-supabase-auth/apply-progress.md` | Unchanged (historical deviation narrative) |
| Verify report | `openspec/changes/archive/2026-10-09-add-supabase-auth/verify-report.md` | Unchanged (immutable snapshot) |
| **Archive report** | `openspec/changes/archive/2026-10-09-add-supabase-auth/archive-report.md` | This file |

## Decisions

- **JWKS endpoint (final truth)**: Implemented and now documented as `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, with optional `SUPABASE_JWKS_URL` override for Docker (`host.docker.internal`). Reconciled in design, proposal, exploration, and the `auth-jwt-verification` delta spec.
- **Database access**: `pg.Pool` (lazy) over `@supabase/supabase-js`/PostgREST — direct TCP to 54322, reuses `DATABASE_URL`, one shared connection manager (design named `pg.Client`; implementation deviation documented in apply-progress).
- **Guard ordering**: `JwtAuthGuard` via `APP_GUARD` before `RolesGuard`; 401 from auth failure, 403 from role mismatch — cannot invert.
- **Roles source of truth**: `public.profiles.role` read fresh per request; no custom claims, no `app_metadata.role`, no cache. Demotion/promotion applies on the next request.
- **Health endpoint**: `/auth/health` is the public probe; `/health` is now protected (401). docker-compose healthcheck updated to `/auth/health` (commit `b1df561`) — confirmed, kept.
- **Review gate**: **Disabled for this clone** — the user ran `gentle-ai review mode disable --scope clone`, so delivery proceeded under ordinary repository policy and this change was **NOT natively reviewed**. No receipt, ledger, or review gate context exists for this candidate; nothing blocks on it.
- **Two-stage archive (orchestrator-scoped)**: The first run produced `archive-report.md` inside the change folder, reconciled stale JWKS references in-place, and explicitly barred `git commit`. A follow-up closure run then completed the mechanical steps: delta specs synced to `openspec/specs/{auth-global-guard,auth-jwt-verification,auth-user-resolution}/spec.md` (created via `cp` → empty `diff -r` → `mv`) and the change folder moved to `openspec/changes/archive/2026-10-09-add-supabase-auth/` via `git mv` (verified by empty `diff -r` snapshot readback). No commit was created — the rename is staged in the index only, per instruction.

## Follow-ups

- [x] Merge the three delta specs into `openspec/specs/{auth-jwt-verification,auth-user-resolution,auth-global-guard}/spec.md` — completed 2026-10-09 (created as full spec copies, empty `diff -r` readback per domain).
- [x] Move the change folder to `openspec/changes/archive/2026-10-09-add-supabase-auth/` — completed 2026-10-09 via mechanical `git mv` with empty snapshot `diff -r` readback. Rename staged in the index; **no commit created** (repo owner commits when ready).
- [ ] Optional (design open question): document `SUPABASE_JWKS_URL` override for Docker in README or `.env.example`.
- [ ] Optional: note in README that `/health` now requires auth; external monitors must probe `/auth/health`.