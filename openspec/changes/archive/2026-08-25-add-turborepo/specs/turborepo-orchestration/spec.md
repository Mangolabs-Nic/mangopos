# Turborepo Orchestration Specification

## Purpose

Turborepo task runner configuration, pipeline definitions, and local caching for the npm workspaces monorepo. Provides a scalable foundation for task orchestration as more packages are added.

## Requirements

### Requirement: Turbo as Root DevDependency

The root `package.json` MUST declare `turbo` as a devDependency. The installed version MUST be stable 2.x.

#### Scenario: Turbo is installed

- GIVEN the repository is freshly cloned
- WHEN `npm install` runs at the root
- THEN `turbo` is available via `npx turbo` or `./node_modules/.bin/turbo`

#### Scenario: Turbo version is deterministic

- GIVEN `turbo` is declared as a devDependency in root `package.json`
- WHEN `npm ci` runs in CI or local setup
- THEN the exact pinned version from `package-lock.json` is installed

### Requirement: Pipeline Configuration

The `turbo.json` file at repository root MUST define pipeline entries for `build` and `start` tasks. Additional pipelines (`lint`, `test`) MAY be added later.

#### Scenario: Build pipeline produces cached output

- GIVEN a workspace package with a `build` script
- WHEN `turbo run build` executes
- THEN the pipeline declares `build/` as the output directory for caching
- AND subsequent identical builds produce a cache hit

#### Scenario: Start pipeline is non-cached and persistent

- GIVEN a workspace package with a `start` script
- WHEN `turbo run start` executes
- THEN the `start` pipeline is marked `cache: false` and `persistent: true`
- AND the dev server runs without turbo interfering with long-lived processes

#### Scenario: Dependency ordering is respected

- GIVEN two workspace packages where B depends on A
- WHEN `turbo run build` executes
- THEN A's build completes before B's build starts

### Requirement: Root Scripts Use Turbo

Root `package.json` scripts that invoke workspace tasks MUST delegate to `turbo run` with `--filter` targeting the appropriate workspace package.

#### Scenario: Docs build uses turbo

- GIVEN the root `package.json` has a `docs:build` script
- WHEN a developer runs `npm run docs:build`
- THEN `turbo run build --filter=@mangolabs/pos-rebuild-docs` executes

#### Scenario: Docs dev uses turbo

- GIVEN the root `package.json` has a `docs:start` script
- WHEN a developer runs `npm run docs:start`
- THEN `turbo run start --filter=@mangolabs/pos-rebuild-docs` executes

### Requirement: Turbo Cache Directory Excluded from Git

The `.turbo/` directory MUST be listed in `.gitignore` so that local cache artifacts are never committed.

#### Scenario: Turbo cache is git-ignored

- GIVEN `.turbo` is appended to `.gitignore`
- WHEN `turbo run build` creates `.turbo/` artifacts
- THEN `git status` does not show `.turbo/` as untracked

### Requirement: CI Workflow Uses Turbo

The GitHub Actions workflow MUST use `turbo run build` for the docs deploy job instead of direct `npm run --workspace` invocations. The workflow path triggers MUST include `turbo.json` so pipeline changes trigger CI.

#### Scenario: CI build step uses turbo

- GIVEN `.github/workflows/docs.yml` has a docs deploy job
- WHEN a push or PR triggers the workflow
- THEN the build step runs `npx turbo run build --filter=@mangolabs/pos-rebuild-docs`

#### Scenario: Turbo config changes trigger CI

- GIVEN the workflow `paths` filter includes `turbo.json`
- WHEN a PR modifies only `turbo.json`
- THEN the docs deploy workflow runs

#### Scenario: CI gets cache benefit

- GIVEN turbo's local cache exists in the CI job
- WHEN an identical build runs within the same job or cache restore
- THEN turbo reports a cache hit and skips redundant rebuild
