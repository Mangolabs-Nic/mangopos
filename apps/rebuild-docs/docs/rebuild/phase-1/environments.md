---
sidebar_position: 2
---

# Environments

## Architecture overview

The deployment is **hybrid**: cloud infrastructure for the API and database, with potential for local-first operation on the client side.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Client (POS)  │────▶│  Cloud (Railway) │────▶│  Supabase       │
│   React SPA     │     │  NestJS API      │     │  Postgres + Auth│
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Environment matrix

| Environment | Purpose | URL | Hosting |
| --- | --- | --- | --- |
| Development | Local development | localhost:3000 (frontend), localhost:4000 (API) | Developer machine |
| Staging | Pre-production testing | staging.mango-labs.dev | Railway |
| Production | Live service | mango-labs.dev | Railway |

## Infrastructure components

### Cloud (Railway — provisional)

| Service | Purpose | Notes |
| --- | --- | --- |
| NestJS API | Backend API server | Containerized, auto-deploys from main |
| Static frontend | React SPA build | Served via CDN or static hosting |

### Supabase

| Service | Purpose | Notes |
| --- | --- | --- |
| Postgres | Primary database | Managed, automatic backups |
| Auth | Authentication & authorization | Row-level security enabled |
| Storage | File uploads (receipts, reports) | Optional, phase-dependent |

## Environment variables

| Variable | Development | Staging | Production |
| --- | --- | --- | --- |
| `DATABASE_URL` | Local postgres | Staging Supabase | Production Supabase |
| `SUPABASE_URL` | Local supabase | Staging supabase | Production supabase |
| `SUPABASE_ANON_KEY` | Local key | Staging key | Production key |
| `NODE_ENV` | development | production | production |

## Backup strategy

| Component | Method | Frequency | Retention |
| --- | --- | --- | --- |
| Postgres (Supabase) | Automatic daily backups | Daily | 7 days (Supabase free tier) |
| Application data | Manual export before migrations | Per migration | Permanent |
| Configuration | Git version control | Continuous | Indefinite |

:::warning
Supabase free tier has limited backup retention. For production, consider upgrading or implementing additional backup logic.
:::
