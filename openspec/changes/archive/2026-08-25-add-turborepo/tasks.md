# Tasks: Add Turborepo

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~25–35 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Full turborepo setup | Single PR | `npx turbo run build --filter=@mangolabs/pos-rebuild-docs` | `npm run docs:build` | Revert all changes (4 files) |

## Phase 1: Installation

- [x] 1.1 Run `npm install --save-dev turbo@^2` in root — adds `turbo` to `package.json` devDependencies and `package-lock.json`

## Phase 2: Configuration

- [x] 2.1 Create `turbo.json` at repo root with `build` (cached, outputs `build/`, depends on `^build`) and `start` (non-cached, persistent) task definitions
- [x] 2.2 Update root `package.json` scripts: `docs:build` → `turbo run build --filter=@mangolabs/pos-rebuild-docs`, `docs:start` → `turbo run start --filter=@mangolabs/pos-rebuild-docs`
- [x] 2.3 Append `.turbo/` to `.gitignore`

## Phase 3: CI Integration

- [x] 3.1 Create `.github/workflows/docs.yml` (or update if exists) — build step uses `npx turbo run build --filter=@mangolabs/pos-rebuild-docs`, add `turbo.json` to `paths` trigger filter

## Phase 4: Verification

- [x] 4.1 Run `npx turbo run build --filter=@mangolabs/pos-rebuild-docs` — confirm successful build
- [x] 4.2 Run `npx turbo run build --filter=@mangolabs/pos-rebuild-docs` again — confirm cache hit (second run shows `FULL TURBO` or cached output)
- [x] 4.3 Run `npm run docs:build` — confirm root script delegation works end-to-end
- [x] 4.4 Run `git status` — confirm `.turbo/` is not listed as untracked
