---
sidebar_position: 2
---

# Deployment guide

## Infrastructure

| Component | Provider | Environment |
| --- | --- | --- |
| API server | Railway | Staging + Production |
| Database | Supabase | Staging + Production |
| Auth | Supabase | Staging + Production |
| Documentation | GitHub Pages | Production |
| Domain | mango-labs.dev | Production |

## Deployment flow

```mermaid
graph LR
    subgraph "Development"
        LOCAL[Local Dev]
    end

    subgraph "CI/CD"
        PUSH[git push]
        CI[GitHub Actions]
        BUILD[Build + Test]
    end

    subgraph "Staging"
        STG_RAILWAY[Railway Staging]
        STG_SUPABASE[Supabase Staging]
    end

    subgraph "Production"
        PRD_RAILWAY[Railway Production]
        PRD_SUPABASE[Supabase Production]
        PAGES[GitHub Pages]
    end

    LOCAL --> PUSH
    PUSH --> CI
    CI --> BUILD
    BUILD -->|main branch| STG_RAILWAY
    BUILD -->|main branch| PAGES
    STG_RAILWAY -->|promote| PRD_RAILWAY
    STG_SUPABASE -->|migrate| PRD_SUPABASE
```

## Environment variables

| Variable | Staging | Production | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | ✅ | PostgreSQL connection string |
| `SUPABASE_URL` | ✅ | ✅ | Supabase project URL |
| `SUPABASE_ANON_KEY` | ✅ | ✅ | Supabase anonymous key |
| `SUPABASE_SERVICE_KEY` | ✅ | ✅ | Supabase service role key |
| `SUPABASE_JWT_SECRET` | — | — | HS256 fallback for a project without a JWKS URL |
| `PIN_PEPPER` | ✅ | ✅ | HMAC pepper for the employee PIN blind index (16+ chars, never rotate) |
| `NODE_ENV` | production | production | Environment mode |
| `PORT` | auto | auto | Server port (Railway assigns) |

## Supabase Auth configuration

Two settings live in Supabase, not in the API:

1. **Custom access token hook.** Locally it is `[auth.hook.custom_access_token]` in
   `supabase/config.toml`; hosted it is Dashboard → Authentication → Hooks → *Customize
   Access Token (JWT) Claims*, pointing at `public.custom_access_token_hook`. Without it
   every token lacks `user_id` / `business_id` and the API answers `503` on login.
2. **Email delivery.** Built-in password recovery needs SMTP configured for the project
   and the frontend origin in *Redirect URLs*. Employee accounts always carry a real
   email, which is what recovery uses.

After changing the local hook configuration, restart the stack (`supabase stop &&
supabase start`); a migration alone does not reload GoTrue's settings.

## Railway deployment

### Initial setup

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link project
railway link

# Set environment variables
railway variables set DATABASE_URL="..."
railway variables set SUPABASE_URL="..."
railway variables set SUPABASE_ANON_KEY="..."
```

### Deploy

```bash
# Deploy to staging
railway up

# Deploy to production
railway up --environment production
```

## Supabase deployment

### Initial setup

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link project
supabase link --project-ref <project-id>

# Push migrations
supabase db push
```

### Migrations

```bash
# Create new migration
supabase migration new <migration_name>

# Apply locally
supabase db reset

# Apply to production
supabase db push
```

## Rollback procedure

| Component | Rollback method |
| --- | --- |
| API (Railway) | Redeploy previous version via Railway dashboard |
| Database | Run `down` migration or restore from backup |
| Auth | Revert to previous Supabase configuration |
| Documentation | Redeploy previous GitHub Pages build |

## Monitoring

| Metric | Tool | Threshold |
| --- | --- | --- |
| API response time | Railway metrics | < 500ms p95 |
| Error rate | Railway logs | < 1% |
| Database connections | Supabase dashboard | < 80% pool usage |
| Uptime | Railway health checks | 99.9% |
