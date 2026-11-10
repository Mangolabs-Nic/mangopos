---
sidebar_position: 3
---

# API reference

## Implemented today

The rest of this page is the **target** API. Only the routes below exist in the codebase
right now (`apps/api`). Anything listed later in this document is not implemented yet.

| Method | Endpoint | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | Bearer JWT | Liveness plus whether `DATABASE_URL` is set |
| GET | `/auth/health` | none | The unauthenticated probe used by the container healthcheck |
| GET | `/diagnostics` | `DIAGNOSTICS_TOKEN` or `DIAGNOSTICS_PUBLIC` | Environment summary for support |
| GET | `/diagnostics/logs?limit=N` | `DIAGNOSTICS_TOKEN` or `DIAGNOSTICS_PUBLIC` | Downloadable log bundle |
| POST | `/auth/login` | none | Email/password grant; returns a Supabase session |
| POST | `/auth/pin` | none | Business slug + employee PIN; returns a Supabase session |
| POST | `/auth/logout` | Bearer JWT | Revokes the session |
| POST | `/auth/recover` | none | Sends the built-in recovery email (always `202`) |
| POST | `/auth/recover/confirm` | none | Sets a new password with the recovery token |
| GET | `/auth/me` | Bearer JWT | The principal the token carries |
| POST | `/auth/employees` | Admin | Creates the auth user, profile and PIN |
| PUT | `/auth/employees/:id/pin` | Admin | Resets an employee PIN |
| GET | `/sales` | Bearer JWT | List sales with their lines |
| GET | `/sales/:id` | Bearer JWT | One sale with its lines |
| POST | `/sales` | Bearer JWT | Record a sale |
| POST | `/sales/:id/void` | Admin, Supervisor | Void a sale, with a reason |
| GET | `/inventory` | Bearer JWT | List the catalogue |
| GET | `/inventory/:id` | Bearer JWT | One product |
| POST | `/inventory` | Admin, Supervisor | Create a product |
| PUT | `/inventory/:id` | Admin, Supervisor | Update a product (not its stock) |
| DELETE | `/inventory/:id` | Admin | Delete a product with no sales history |
| POST | `/inventory/adjust` | Admin, Supervisor | Record a stock movement |
| GET | `/expenses` | Admin, Supervisor | List expenses |
| POST | `/expenses` | Bearer JWT | Record an expense |
| PUT | `/expenses/:id` | Admin, Supervisor | Correct an expense |
| DELETE | `/expenses/:id` | Admin | Delete an expense |
| GET | `/reports/sales` | Admin, Supervisor | Sales totals per day/week/month |
| GET | `/reports/inventory` | Admin, Supervisor | Inventory valuation |
| GET | `/reports/expenses` | Admin, Supervisor | Expense breakdown by category |
| GET | `/reports/profit` | Admin, Supervisor | Revenue, COGS, expenses, net profit |
| GET | `/reports/sales/export` | Admin, Supervisor | Sales report as CSV or PDF |
| GET | `/reports/inventory/export` | Admin, Supervisor | Inventory report as CSV or PDF |
| GET | `/reports/expenses/export` | Admin, Supervisor | Expense report as CSV or PDF |
| GET | `/reports/profit/export` | Admin, Supervisor | Profit report as CSV or PDF |

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
| `DIAGNOSTICS_TOKEN` | unset | When set, `/diagnostics*` requires the `x-diagnostics-token` header |
| `DIAGNOSTICS_PUBLIC` | unset | Opens `/diagnostics*` without a token outside production |
| `CORS_ALLOWED_ORIGINS` | see [CORS](#cors) | Comma-separated origins allowed to call the API |
| `SUPABASE_URL` | — | GoTrue and PostgREST base URL |
| `SUPABASE_ANON_KEY` | — | Public key for the password/recovery/verify calls |
| `SUPABASE_SERVICE_KEY` | — | Server only: admin user calls and RPCs |
| `SUPABASE_JWT_SECRET` | unset | HS256 fallback, used only when `SUPABASE_URL` is unset |
| `PIN_PEPPER` | unset | HMAC pepper for the PIN blind index (16+ chars) |

Secrets are masked before writing: object keys matching `pin`, `password`, `token`,
`secret`, `authorization`, `cookie` and `api_key` become `***`, and inline forms such as
`pin=9911` or `{"token": "abc"}` are redacted in free text too. The masking covers `data`,
`msg` and `context`, so a PIN interpolated into the event name is masked too.

:::caution
`/diagnostics` is **closed by default**. It answers only when one of the following holds:

- `DIAGNOSTICS_TOKEN` is set, and the request carries the same value in the
  `x-diagnostics-token` header (compared in constant time).
- `DIAGNOSTICS_TOKEN` is unset **and** `DIAGNOSTICS_PUBLIC` is set to `true`, `1`, `yes` or
  `on` (case-insensitive, surrounding whitespace ignored) **and** `NODE_ENV` is not
  `production`.

Anything else — an absent, empty, `false`, `0`, `no` or `off` value, or any other
unrecognised spelling — is read as *closed*. This is a security gate, so it fails closed on
purpose: an operator who sets `DIAGNOSTICS_PUBLIC=false` gets closed diagnostics, never open
ones. `DIAGNOSTICS_PUBLIC` cannot open diagnostics in production under any value.

A wrong token gets `401 invalid diagnostics token`; closed diagnostics get
`401 diagnostics are disabled`. When diagnostics are unreachable at boot, the API emits one
`warn` line:

```json
{"level":"warn","msg":"diagnostics_closed","data":{"hint":"diagnostics are closed: set DIAGNOSTICS_TOKEN to reopen them for support"}}
```

Set `DIAGNOSTICS_TOKEN` before exposing the API to support.
:::

## Base URL

| Environment | URL |
| --- | --- |
| Development | `http://localhost:4000/api` |
| Staging | `https://staging-api.mango-labs.dev/api` |
| Production | `https://api.mango-labs.dev/api` |

## Authentication

Every request except `/auth/health`, `/diagnostics*` and the login/recovery endpoints requires a
Supabase access token:

```
Authorization: Bearer <access_token>
```

The token is issued by Supabase Auth and verified by `JwtAuthGuard` against the project's
JWKS (ES256/RS256). `SUPABASE_JWT_SECRET` is only a fallback for a project with no
`SUPABASE_URL`; using it against an ES256 project would reject every real token. The token
has to carry the claims added by the `custom_access_token_hook`:

| Claim | Source | Used for |
| --- | --- | --- |
| `sub` | Supabase Auth | The user id |
| `user_id` | hook, mirrors `sub` | The actor recorded in the audit trail |
| `business_id` | `profiles.business_id` | Tenant scope |
| `app_role` | `profiles.role` | `RolesGuard` |
| `active` | `profiles.active` | Refuses a deactivated account |

Answers:

| Status | When |
| --- | --- |
| `401` | No token, bad signature, expired, or a token without the claims above |
| `403` | The account is inactive, or the role is not allowed on the route |
| `503` | JWT verification is not configured, or the claims hook is not enabled |

Two different freshness rules, on purpose. A **role change** applies when the token is
refreshed (`jwt_expiry`, one hour by default), because the role travels in the token.
**Deactivation** stops RLS-backed data access immediately: every policy resolves tenancy
through `current_business_id()` / `current_role()`, and both require `active`. The `active`
claim in an already-issued token is a snapshot, so this API refuses the account (`403`) at
the next refresh; to cut an open session sooner, revoke that user's sessions in Supabase
Auth.

### Employee PIN login

The legacy PIN flow is kept, but it is no longer the authentication mechanism - it is a
lookup into Supabase Auth:

1. `POST /auth/pin { "business": "mi-tienda", "pin": "4821" }`
2. The API computes `HMAC-SHA256(pin, PIN_PEPPER)`. The PIN itself is never stored, logged
   or sent to the database.
3. `employee_pin_login(slug, digest, address)` resolves the business and the active
   employee, and records the attempt. Ten failures from one address in fifteen minutes
   lock it; the answer is `429` with `retry_after_seconds`.
4. The API generates a one-time magic link for the resolved email and immediately
   exchanges it for a session. No mail is sent.
5. The session is the same JWT, with the same claims, as an email/password login.

The PIN is **not** the password. Changing the password (or recovering it) does not break
the PIN, and changing the PIN does not touch the password. Every employee therefore has a
real email and can use Supabase's built-in recovery.

`PIN_PEPPER` is required (16+ characters). Without it the endpoints answer `503` rather
than falling back to an unpeppered digest. Changing the pepper invalidates every PIN.

### Recovery

`POST /auth/recover { "email": "..." }` always answers `202`, whether or not the address
exists, so it cannot be used to enumerate accounts. Supabase sends the built-in recovery
mail. The link points at GoTrue's `/auth/v1/verify`, which redirects to `redirect_to` (or
the project's `site_url`) with `#access_token=...&type=recovery` in the fragment; the
frontend reads that token and calls
`POST /auth/recover/confirm { "access_token": "...", "password": "..." }`.

`redirect_to` must be listed in `additional_redirect_urls` (`supabase/config.toml` locally,
Authentication → URL Configuration when hosted). An unlisted URL is replaced by `site_url`
without an error. Employees created through the API always have a real email, which is what
makes this work for PIN-only staff.

## CORS

`CORS_ALLOWED_ORIGINS` is a **comma-separated** allowlist of browser origins. Spaces around
each entry are trimmed and empty entries are dropped:

```
CORS_ALLOWED_ORIGINS=https://app.mango-labs.dev,https://admin.mango-labs.dev
```

| Value | Result |
| --- | --- |
| A non-empty list | Exactly those origins are allowed |
| Unset, `NODE_ENV=production` | **Nothing** is allowed |
| Unset, any other `NODE_ENV` | `http://localhost:5173` is allowed |
| Set but blank or only separators (`,`) | Treated as unset, so the row above applies |

The API never reflects a wildcard: `Access-Control-Allow-Origin` is only emitted for an
origin on the list, and `credentials` is enabled, so cookies and `Authorization` headers
travel with allowed requests.

:::caution
With no `CORS_ALLOWED_ORIGINS` set, **production allows no origin at all**, and the browser
frontend is blocked before it ever reaches a handler — the response simply carries no
`Access-Control-Allow-Origin` header and the request fails in the console. There is no boot
log for this: an empty allowlist is silent, and the only exposure-related boot line is the
`diagnostics_closed` warning above. Set `CORS_ALLOWED_ORIGINS` to the deployed frontend
origin as part of the release.
:::

## Endpoints

### Auth

Implemented, as listed under [Implemented today](#implemented-today): `POST /auth/login`,
`POST /auth/pin`, `POST /auth/logout`, `POST /auth/recover`,
`POST /auth/recover/confirm`, `GET /auth/me`, `POST /auth/employees` and
`PUT /auth/employees/:id/pin`.

The routes below this point are still the target API.

### Reports

Implemented, `admin` and `supervisor` only; a `cashier` gets `403`. Reads are never
written to the audit trail.

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/reports/sales` | Sales totals per bucket |
| GET | `/reports/inventory` | Inventory valuation |
| GET | `/reports/expenses` | Expense breakdown by category |
| GET | `/reports/profit` | Revenue, COGS, expenses and net profit |
| GET | `/reports/sales/export` | The same report as a file |
| GET | `/reports/inventory/export` | The same report as a file |
| GET | `/reports/expenses/export` | The same report as a file |
| GET | `/reports/profit/export` | The same report as a file |

| Parameter | Where | Required | Meaning |
| --- | --- | --- | --- |
| `from` | query | yes, except inventory | Inclusive local date, `YYYY-MM-DD` |
| `to` | query | yes, except inventory | Inclusive local date, `YYYY-MM-DD` |
| `granularity` | query | no (`day`) | `day`, `week` or `month` for sales |
| `format` | export only | no (`csv`) | `csv` or `pdf` |

`from` and `to` are interpreted in `businesses.timezone` (default `America/Managua`), not
UTC. Only sales whose `sales.currency` matches the business currency are included; the
schema has no exchange-rate table yet.

Responses are the rows themselves, not the `{ data, meta }` envelope used by the target API:

```json
GET /reports/profit?from=2026-11-01&to=2026-11-07

{
  "currency": "NIO",
  "sale_count": 12,
  "revenue": 8450,
  "tax": 0,
  "cogs": 5120,
  "gross_profit": 3330,
  "expenses": 1200,
  "net_profit": 2130
}
```

- Sales: array of `bucket`, `sale_count`, `voided_count`, `subtotal`, `tax`, `total`.
  Voided sales are counted but excluded from every sum.
- Inventory: one row with `product_count`, `service_count`, `unit_count`, `cost_value`,
  `retail_value`, `low_stock_count`.
- Expenses: array of `category`, `entry_count`, `total`.
- Profit: one row as above. COGS uses `sale_items.unit_cost`, the cost snapshotted when
  the line was written, so editing a product today does not rewrite past profit.

Exports send `content-disposition: attachment` with a filename that includes the range,
for example `sales-2026-11-01_2026-11-07.csv`.

The routes below this point are still the target API.

### Sales

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/sales` | List sales with their lines, newest first (`limit`, `offset`) | All |
| GET | `/sales/:id` | Get sale details | All |
| POST | `/sales` | Create new sale | All |
| POST | `/sales/:id/void` | Void a sale, with a reason | Admin, Supervisor |
| GET | `/sales/:id/receipt` | Generate receipt | All |

`POST /sales` sends products and quantities only. The database prices every line from the
catalogue and moves the stock in the same statement, so a client never sends a price or a
total:

```json
{
  "items": [{ "product_id": "0b8f…", "quantity": 2 }],
  "tax": "0.50",
  "payment_method_id": "7d31…"
}
```

`tax` and `payment_method_id` are optional. The answer is the stored sale plus its
`sale_items`. No stock left answers `409`; an unknown or inactive product, a foreign
tenant's product and a zero quantity answer `400`.

Voiding needs a `reason`; a second void answers `409`. A void is the only edit a completed
sale accepts, and it returns the units to stock.

`GET /sales/:id/receipt` is not implemented yet.

### Inventory

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/inventory` | List products with stock (`active=true\|false`, `limit`, `offset`) | All |
| GET | `/inventory/:id` | Get product details | All |
| POST | `/inventory` | Create product | Admin, Supervisor |
| PUT | `/inventory/:id` | Update product (not its stock) | Admin, Supervisor |
| DELETE | `/inventory/:id` | Delete a product with no sales history | Admin |
| POST | `/inventory/adjust` | Adjust stock level | Admin, Supervisor |

`stock` cannot be written through `PUT /inventory/:id`; it answers `400` and points at
`POST /inventory/adjust`, the only path that moves it:

```json
{ "product_id": "0b8f…", "adjustment": -1, "reason": "breakage" }
```

That records a `stock_adjustments` row — who, before, after — and lets the database apply
the change, so the ledger and the shelf cannot disagree. `adjustment` is a signed integer
and cannot be zero. Deleting a product that has been sold answers `409`; deactivate it
with `"active": false` instead.

### Expenses

| Method | Endpoint | Description | Roles |
| --- | --- | --- | --- |
| GET | `/expenses` | List expenses | Admin, Supervisor |
| POST | `/expenses` | Create expense | All |
| PUT | `/expenses/:id` | Update expense | Admin, Supervisor |
| DELETE | `/expenses/:id` | Delete expense | Admin |

`POST /expenses` takes `amount`, plus an optional `category` (60 characters) and
`description` (500). Anyone on shift may record one — the money already left the till —
but only a supervisor or admin may correct or delete it.

The Users and Audit sections below are still the target API.

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

The implemented routes return the row, or the array of rows, at the top level. There is no
`data`/`meta` envelope; a listing route pages with `limit` and `offset`.

### Error

The implemented routes answer with Nest's default shape, so `statusCode` is the number and
`message` is the one sentence the POS can show:

```json
{
  "statusCode": 409,
  "message": "not enough stock for this sale",
  "error": "Conflict"
}
```

The envelope below is the target shape.

## Rate limits

| Tier | Requests/minute | Burst |
| --- | --- | --- |
| Free | 60 | 10 |
| Paid | 300 | 50 |
