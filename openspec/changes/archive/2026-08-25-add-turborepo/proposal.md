# Proposal: Add Turborepo

## Intent

Add Turborepo as the task orchestrator for the npm workspaces monorepo. Currently the repo has a single workspace (`@mangolabs/pos-rebuild-docs`) with manual `npm run --workspace` scripts. Turborepo provides task caching, parallel execution, and a scalable pipeline definition — foundational infrastructure as more packages are added.

## Scope

### In Scope
- Install `turbo` as a root devDependency
- Create `turbo.json` with `build` and `start` pipeline definitions
- Update root `package.json` scripts to use `turbo run` instead of `npm run --workspace`
- Add `.turbo` to `.gitignore`
- Update CI workflow to use `turbo run build` for the docs deploy job

### Out of Scope
- Switching package manager (staying on npm)
- Remote caching setup (local caching only for now)
- Adding new packages or workspaces
- Linting, testing, or any app-level changes

## Capabilities

### New Capabilities
- `turborepo-orchestration`: Turborepo task runner configuration, pipeline definitions, and local caching

### Modified Capabilities
None — no existing specs to modify.

## Approach

1. `npm install turbo --save-dev` at root
2. Create `turbo.json` with `build` (depends on `^build`, outputs `build/`) and `start` (no cache, persistent) pipelines
3. Replace root scripts: `"docs:build": "turbo run build --filter=@mangolabs/pos-rebuild-docs"`, same pattern for `docs:start`
4. Append `.turbo` to `.gitignore`
5. Update `.github/workflows/docs.yml` build step to `npx turbo run build --filter=@mangolabs/pos-rebuild-docs`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `package.json` (root) | Modified | New devDependency + updated scripts |
| `turbo.json` (new) | Created | Pipeline configuration |
| `.gitignore` | Modified | Add `.turbo` directory |
| `.github/workflows/docs.yml` | Modified | Use turbo for build step |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Single workspace = modest immediate value | Low | Acceptable — migration cost is near-zero, value compounds with future packages |
| Turbo version drift | Low | Pin to latest stable (2.x), update lock file |

## Rollback Plan

Remove `turbo` from devDependencies, delete `turbo.json`, revert root scripts to `npm run --workspace`, remove `.turbo` from `.gitignore`, revert CI workflow. No data or config changes to undo.

## Dependencies

- None — turbo is a devDependency only, no external services required.

## Success Criteria

- [ ] `turbo run build` successfully builds the Docusaurus site
- [ ] `turbo run build` second run shows cache hit
- [ ] CI workflow deploys successfully using turbo
- [ ] No behavioral change in dev workflow (`npm run docs:start` still works)
