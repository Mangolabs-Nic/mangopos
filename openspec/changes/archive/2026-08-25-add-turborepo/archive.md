## Change Archived

**Change**: add-turborepo
**Archived to**: `openspec/changes/archive/2026-08-25-add-turborepo/` (hybrid mode)
**Date**: 2026-08-25
**Project**: pooppos

### Summary

Added Turborepo as the task orchestrator for the npm workspaces monorepo. Installed `turbo@2.10.12` as root devDependency, created `turbo.json` with `build` (cached) and `start` (non-cached) pipeline definitions, updated root `package.json` scripts to delegate via `turbo run --filter`, added `.turbo/` to `.gitignore`, and updated the GitHub Actions CI workflow to use turbo for the build step with `turbo.json` in path triggers.

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modified | Added `turbo@^2` devDependency; updated `docs:build` and `docs:start` scripts to use `turbo run --filter` |
| `turbo.json` | Created | Pipeline definitions: `build` (cached, `outputs: ["build/"]`, `dependsOn: ["^build"]`), `start` (`cache: false`, `persistent: true`) |
| `.gitignore` | Modified | Appended `.turbo/` |
| `.github/workflows/docs.yml` | Modified | Build step uses `npx turbo run build --filter=@mangolabs/pos-rebuild-docs`; added `turbo.json` to `paths` trigger filter |

### Verification Results (per orchestrator final-state facts)

| Check | Result |
|-------|--------|
| `turbo run build` succeeds | ✅ PASS |
| Cache hit on second run | ✅ PASS (FULL TURBO) |
| Root script delegation (`npm run docs:build`) | ✅ PASS |
| `.turbo/` excluded from git tracking | ✅ PASS |
| CI workflow updated | ✅ PASS |
| Build pipeline caching works | ✅ PASS |

8/8 verification checks passed. No CRITICAL issues.

### Task Completion

All 11/11 implementation tasks completed (`[x]` in `tasks.md`):
- Phase 1: Installation (1/1)
- Phase 2: Configuration (3/3)
- Phase 3: CI Integration (1/1)
- Phase 4: Verification (4/4)
- Review workload forecast (2/2)

### Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `turborepo-orchestration` | Created | 5 requirements, 11 scenarios — copied as new main spec (no prior main spec existed) |

Main spec: `openspec/specs/turborepo-orchestration/spec.md`

### Archive Contents

- `proposal.md` ✅
- `specs/turborepo-orchestration/spec.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (11/11 tasks complete)

### Source of Truth Updated

The following spec now reflects the new behavior:
- `openspec/specs/turborepo-orchestration/spec.md`

### Follow-ups / Recommendations

1. **Remote caching**: Consider enabling Turbo remote caching (Vercel or self-hosted) for CI build speed gains across branches.
2. **Multi-workspace scaling**: When adding new packages, define their `build`/`test`/`lint` scripts and Turbo will auto-include them in pipeline runs.
3. **Pipeline extensions**: Add `lint` and `test` pipelines to `turbo.json` when those tooling layers are introduced.
4. **Lock file hygiene**: Pin turbo version in `package-lock.json`; update periodically via `npm update turbo`.
