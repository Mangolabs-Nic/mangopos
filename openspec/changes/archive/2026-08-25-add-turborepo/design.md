# Design: Add Turborepo

## Technical Approach

Add Turborepo as root devDependency with `turbo.json` defining `build` (cached, dependency-ordered) and `start` (persistent, non-cached) pipelines. Root scripts delegate via `--filter`. CI workflow updated to use turbo for build step with `turbo.json` added to path triggers. Zero behavioral change to developer workflow — pure tooling layer.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Turbo version | 2.x stable vs 1.x | 2.x has better caching and `turbo run` improvements; 1.x is EOL | `^2` |
| Cache location | Default `.turbo/` vs custom | Default is standard, zero config | `.turbo/` (default) |
| Script delegation | `turbo run --filter` vs direct `npm run --workspace` | Turbo adds caching and dependency awareness; npm workspace is simpler but no cache | `turbo run --filter` |
| Root script granularity | Per-workspace prefix vs generic `turbo run` | Per-workspace keeps intent clear for a single-workspace repo | Per-workspace (`docs:build`, `docs:start`) |

## Data Flow

```
npm run docs:build
    └── turbo run build --filter=@mangolabs/pos-rebuild-docs
            └── builds rebuild-docs (outputs: build/, cached by turbo)

turbo run build  (future, multi-workspace)
    ├── A (build) ──^build──→ B (build) ──^build──→ C (build)
    │
    └── cache hits skip rebuilds for unchanged packages
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `turbo.json` | Create | Pipeline definitions for `build` and `start` |
| `package.json` | Modify | Add `turbo` devDependency, update scripts to use `turbo run` |
| `.gitignore` | Modify | Append `.turbo/` |
| `.github/workflows/docs.yml` | Modify | Replace build command with turbo, add `turbo.json` to path triggers |

## Interfaces / Contracts

**turbo.json** (new):
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["build/"],
      "inputs": ["src/**"]
    },
    "start": {
      "cache": false,
      "persistent": true
    }
  }
}
```

**Root package.json scripts** (modified):
```json
{
  "docs:build": "turbo run build --filter=@mangolabs/pos-rebuild-docs",
  "docs:start": "turbo run start --filter=@mangolabs/pos-rebuild-docs"
}
```

**CI build step** (modified):
```yaml
- run: npx turbo run build --filter=@mangolabs/pos-rebuild-docs
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Local | `turbo run build` succeeds | Run at root, verify `apps/rebuild-docs/build/` exists |
| Local | Cache hit on second run | Run `turbo run build` twice, second shows `[INTEGER海滨 cache hit]` or `0.0s` |
| Local | `turbo run start` launches dev server | Run at root, verify Docusaurus dev server starts |
| Local | `npm run docs:build` still works | Verify root script delegation works end-to-end |
| CI | Workflow runs with turbo | Push change, verify deploy job succeeds |
| CI | Path trigger fires on turbo.json change | Modify only turbo.json, verify workflow triggers |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. This is a tooling addition — no data, schema, or config changes that affect existing behavior. Remove turbo and revert scripts to roll back.

## Open Questions

None — design is fully specified by the spec and proposal.
