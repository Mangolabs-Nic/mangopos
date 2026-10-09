---
sidebar_position: 1
---

# Development setup

## Prerequisites

| Tool | Version | Purpose |
| --- | --- | --- |
| Node.js | ≥ 20 (24 recommended) | Runtime |
| npm | ≥ 10 | Package manager and workspaces |
| Docker Desktop | Latest | Runs the API container and the local database |
| Supabase CLI | `npm i -g supabase` | Local Postgres, Auth, REST and Studio |
| Git | Latest | Version control |

## Quick start

```bash
git clone https://github.com/Mangolabs-Nic/pooppos.git
cd pooppos
npm install
npm run dev
```

`npm run dev` builds the API image, starts the local Supabase stack, and brings the
API up. On a first run Docker will pull images, so allow several minutes.

## Local services

| Service | URL | Notes |
| --- | --- | --- |
| API | `http://127.0.0.1:4000/health` | Liveness; reports whether `DATABASE_URL` is set |
| Supabase Studio | `http://127.0.0.1:54323` | Table browser and SQL editor |
| Supabase API (Kong) | `http://127.0.0.1:54321` | REST, GraphQL, Auth and Storage behind one gateway |
| Mailpit | `http://127.0.0.1:54324` | Captures all outgoing email |
| Postgres | `127.0.0.1:54322` | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

Kong returns 404 on its root path by design — it is a gateway with no root route.
Use `http://127.0.0.1:54321/auth/v1/health` to confirm it is routing.

:::caution[Mailpit is required, not optional]
Password-reset and staff-invite emails are captured by Mailpit rather than
delivered. Auth flows cannot be completed without it.
:::

## Why two orchestrators

`supabase start` owns the database containers. `docker compose` owns only the API.
They are deliberately not merged: two orchestrators managing the same containers
compete for networks, volumes and published ports. `npm run dev` chains them.

## Networking inside the container

The API container cannot reach the database on `127.0.0.1` — inside a container that
address refers to the container itself. `docker-compose.yml` therefore overrides
`DATABASE_URL` and `SUPABASE_URL` to use `host.docker.internal`. Only those two are
substituted; keys still come from `.env`.

## Configuration

```bash
cp .env.example .env
supabase status    # prints the current local values
```

Fill `.env` from that output. Local keys are regenerated on every
`supabase start`, so a hand-copied file goes stale.

| Variable | Development | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Local Postgres | Connection string |
| `SUPABASE_URL` | `http://127.0.0.1:54321` | Project URL |
| `SUPABASE_ANON_KEY` | Local key | Public, browser-safe |
| `SUPABASE_SERVICE_KEY` | Local key | **Bypasses RLS. Server-side only.** |
| `NODE_ENV` | `development` | Mode |
| `PORT` | `4000` | API port |

`.env` is gitignored. `.env.example` is committed and must contain no real values.

## Available commands

| Command | Description |
| --- | --- |
| `npm run dev` | Build the API image and start the full local stack |
| `npm run dev:logs` | Tail API container logs |
| `npm run dev:down` | Stop the API container |
| `supabase stop` | Stop the local database stack |
| `npm run api:dev` | Run the API on the host with watch mode |
| `npm run api:build` | Build the API through Turborepo |
| `npm run api:test` | Run API unit tests |
| `npm run docs:start` | Start the documentation dev server |
| `npm run docs:build` | Build the documentation for production |
| `npm run turbo:graph` | Visualize the task dependency graph |

Use `npm run api:dev` for the inner edit loop — it skips the image build. Use
`npm run dev` when you need the container itself, for example to verify container
networking or the production dependency tree.

## Database migrations

Schema is versioned in `supabase/migrations` and applied by the Supabase CLI, never
by the API container.

```bash
supabase db reset              # rebuild from empty; development only
supabase migration new <name>  # create a new migration
supabase status                # service health and local values
```

`supabase/config.toml` runs a reduced service profile. Analytics, edge runtime,
realtime and storage are disabled because the MVP does not use them; each is a
one-line change. Analytics is also disabled because its Vector log shipper
crash-loops on Windows Docker Desktop.

## Project structure

```
pooppos/
├── apps/
│   ├── api/                  # NestJS API (@mangolabs/pos-api)
│   │   ├── src/
│   │   ├── test/
│   │   ├── Dockerfile
│   │   └── dist/             # build output, gitignored
│   └── rebuild-docs/         # Docusaurus documentation
│       ├── docs/             # Markdown documentation
│       ├── src/              # React components and diagrams
│       └── docusaurus.config.mjs
├── supabase/
│   ├── migrations/           # versioned Postgres schema
│   └── config.toml           # local service profile
├── docker-compose.yml        # API container only
├── turbo.json
├── .env.example
└── package.json              # npm workspaces root
```

## POS application setup

:::info
The legacy desktop POS source code lives in a separate repository and is not part
of this one. Its SQLite schema has been extracted for migration purposes; see
[Database schema](./database).
:::
