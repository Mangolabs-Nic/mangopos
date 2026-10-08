# MangoPOS

MangoLabs POS rebuild. An npm workspaces monorepo running Turborepo, containing the
NestJS API, the Docusaurus documentation site, and the Supabase schema for the
PoopPOS pilot.

## Prerequisites

| Tool | Version | Purpose |
| --- | --- | --- |
| Node.js | ≥ 20 (24 recommended) | Runtime |
| npm | ≥ 10 | Package manager and workspaces |
| Docker Desktop | Latest | Runs the API container and the local database |
| Supabase CLI | `npm i -g supabase` | Local Postgres, Auth and REST |

## Start everything

```bash
npm install
npm run dev
```

That builds the API image, starts the local Supabase stack, and brings the API up.
Then:

| Service | URL |
| --- | --- |
| API health | <http://127.0.0.1:4000/health> |
| Supabase Studio | <http://127.0.0.1:54323> |
| Supabase API (Kong) | <http://127.0.0.1:54321> |
| Mailpit (captured email) | <http://127.0.0.1:54324> |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

`npm run dev` runs two orchestrators on purpose. `supabase start` owns the database
containers; `docker compose` owns only the API. They are never mixed — two
orchestrators over the same containers fight over networks, volumes and ports.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Build the API image and start the full local stack |
| `npm run dev:logs` | Tail API container logs |
| `npm run dev:down` | Stop the API container |
| `supabase stop` | Stop the local database stack |
| `npm run api:dev` | Run the API on the host with watch mode (faster inner loop) |
| `npm run api:build` | Build the API through Turborepo |
| `npm run api:test` | Run API unit tests |
| `npm run docs:start` | Start the documentation dev server |
| `npm run docs:build` | Build the documentation for production |
| `npm run turbo:graph` | Visualize the task dependency graph |

## Configuration

Copy `.env.example` to `.env` and fill it. Local values are printed by
`supabase status`; they are regenerated on every `supabase start`, so do not
hand-copy them.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public key, safe in the browser bundle |
| `SUPABASE_SERVICE_KEY` | **Bypasses row-level security. Server-side only.** |
| `NODE_ENV` | `development` or `production` |
| `PORT` | API port, 4000 |

`.env` is gitignored. `.env.example` is committed and must stay secret-free.

> **Caution**
> The API container cannot use `127.0.0.1` to reach the database: inside a container
> that address is the container itself. `docker-compose.yml` substitutes
> `host.docker.internal` for that reason. Only the values in `.env` are overridden.

## Database

Schema lives in `supabase/migrations` and is applied by the Supabase CLI, not by the
API container.

```bash
supabase db reset      # rebuild from empty — safe in development
supabase migration new <name>
```

`supabase/config.toml` runs a reduced service profile: analytics, edge runtime,
realtime and storage are disabled because the MVP does not use them. Enabling them
is a one-line change each.

## Layout

```
MangoPOS/
├── apps/
│   ├── api/                  # NestJS API (@mangolabs/mangopos-api)
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── dist/             # build output, gitignored
│   └── rebuild-docs/         # Docusaurus documentation
├── supabase/
│   ├── migrations/           # versioned Postgres schema
│   └── config.toml           # local service profile
├── docs/                     # root documentation entry point
├── docker-compose.yml        # API container only
├── turbo.json
└── package.json              # npm workspaces root
```

## Documentation

Full documentation builds at `/docs` on GitHub Pages. Start it locally with
`npm run docs:start`.

- [Development setup](apps/rebuild-docs/docs/operations/development.md)
- [Database schema](apps/rebuild-docs/docs/operations/database.md)
- [Deployment](apps/rebuild-docs/docs/operations/deployment.md)
