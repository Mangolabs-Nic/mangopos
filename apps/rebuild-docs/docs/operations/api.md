---
sidebar_position: 3
---

# API reference

## Implemented today

The rest of this page is the **target** API. Only the routes below exist in the codebase
right now (`apps/api`). Anything listed later in this document is not implemented yet.

| Method | Endpoint | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | none | Liveness plus whether `DATABASE_URL` is set |
| GET | `/diagnostics` | `DIAGNOSTICS_TOKEN` | Environment summary for support |
| GET | `/diagnostics/logs?limit=N` | `DIAGNOSTICS_TOKEN` | Downloadable log bundle |

## Logging

Every line is a single JSON object on **stdout**, which is what Railway and Docker collect:

```json
{"time":"2026-10-08T21:24:07.235Z","level":"log","msg":"http_request","data":{"method":"GET","path":"/health","status":200,"durationMs":3.24}}
```

| Key | Meaning |
| --- | --- |
| `time` | ISO-8601 timestamp |
| `level` | `verbose` · `debug` · `log` · `warn` · `error` · `fatal` |
| `msg` | Stable, greppable event name (never a sentence) |
| `context` | Present when Nest supplies a class name |
| `data` | Structured payload, already redacted |

Each completed request logs one `http_request` event with method, path, status and
duration. Every response carries an `x-request-id` header (also echoed as
`x-request-id`) so a user-reported failure maps back to a log line. Status ≥ 400 logs at
`warn`, ≥ 500 at `error`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOG_LEVEL` | `log` | Minimum level to emit |
| `LOG_BUFFER_SIZE` | `500` | Records kept in memory for `/diagnostics` |
| `DIAGNOSTICS_TOKEN` | unset | When set, `/diagnostics*` requires `x-diagnostics-token` |

Secrets are masked before writing: object keys matching `pin`, `password`, `token`,
`secret`, `authorization`, `cookie` and `api_key` become `***`, and inline forms such as
`pin=9911` or `{"token": "abc"}` are redacted in free text too.

:::caution
`/diagnostics` is **open when `DIAGNOSTICS_TOKEN` is unset**. That is acceptable on a
developer machine but not in production — the API logs a `diagnostics_token_missing`
warning at boot when `NODE_ENV=production` and no token is configured. Set the token
before exposing it.
:::

## Base URL

| Environment | URL |
| --- | --- |
| Development | `http://localhost:4000/api` |
| Staging | `https://staging-api.mango-labs.dev/api` |
| Production | `https://api.mango-labs.dev/api` |

## Authentication

All API requests require a JWT token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

Token is obtained via Supabase Auth login endpoint.

## Endpoints

### Auth

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/auth/login` | Login with email/password |
| POST | `/auth/logout` | Invalidate current session |
| GET | `/auth/me` | Get current user profile |

### Sales

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/sales` | List sales (filtered by role) | All |
| GET | `/sales/:id` | Get sale details | All |
| POST | `/sales` | Create new sale | Admin, Cashier |
| POST | `/sales/:id/void` | Void a sale | Admin, Cashier |
| GET | `/sales/:id/receipt` | Generate receipt | All |

### Inventory

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/inventory` | List products with stock | All |
| GET | `/inventory/:id` | Get product details | All |
| POST | `/inventory` | Create product | Admin, Supervisor |
| PUT | `/inventory/:id` | Update product | Admin, Supervisor |
| DELETE | `/inventory/:id` | Delete product | Admin |
| POST | `/inventory/adjust` | Adjust stock level | Admin, Supervisor |

### Expenses

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/expenses` | List expenses | Admin, Supervisor |
| POST | `/expenses` | Create expense | All |
| PUT | `/expenses/:id` | Update expense | Admin, Supervisor |
| DELETE | `/expenses/:id` | Delete expense | Admin |

### Reports

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/reports/sales` | Sales report (date range) | Admin, Supervisor |
| GET | `/reports/sales/export` | Export sales report | Admin, Supervisor |
| GET | `/reports/inventory` | Inventory report | Admin, Supervisor |
| GET | `/reports/financial` | Financial summary | Admin |

### Users

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/users` | List users | Admin |
| POST | `/users` | Create user | Admin |
| PUT | `/users/:id` | Update user | Admin |
| PUT | `/users/:id/role` | Change user role | Admin |
| DELETE | `/users/:id` | Deactivate user | Admin |

### Audit

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/audit` | List audit logs | Admin |
| GET | `/audit/user/:id` | Audit logs for user | Admin, Supervisor |

## Response format

### Success

```json
{
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150
  }
}
```

### Error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [
      {
        "field": "amount",
        "message": "Amount must be positive"
      }
    ]
  }
}
```

## Rate limits

| Tier | Requests/minute | Burst |
| --- | --- | --- |
| Free | 60 | 10 |
| Paid | 300 | 50 |
