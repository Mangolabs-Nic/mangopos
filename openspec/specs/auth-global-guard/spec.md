# Delta for auth-global-guard

## ADDED Requirements

### Requirement: Global Guard Populates request.user

The auth guard MUST be registered globally for the API. On a verified token with a resolvable active profile it MUST set `request.user = { sub, appRole, businessId }` before the route handler runs.

#### Scenario: Valid token populates request.user

- GIVEN a request with a valid Supabase access token for an active profile
- WHEN the global auth guard runs
- THEN `request.user` equals `{ sub, appRole, businessId }` with values from the token and `profiles`
- AND the route handler executes

#### Scenario: Unauthenticated request is rejected before the handler

- GIVEN a protected route request without a usable token
- WHEN the global auth guard runs
- THEN the system responds with HTTP 401
- AND the route handler does not execute

### Requirement: Guard Ordering Before RolesGuard

The auth guard MUST run before the existing `RolesGuard`. `RolesGuard` MUST evaluate `request.user.appRole` populated by the auth guard.

#### Scenario: RolesGuard sees the resolved appRole

- GIVEN a `@Roles('admin')` route with a valid token whose profile role is `admin`
- WHEN the request passes through both guards
- THEN the auth guard runs first and the `RolesGuard` passes
- AND the route handler executes

#### Scenario: Insufficient role returns 403

- GIVEN a `@Roles('admin')` route with a valid token whose profile role is `cashier`
- WHEN the request passes through both guards
- THEN the auth guard passes (HTTP 401 is not returned)
- AND the `RolesGuard` rejects the request with HTTP 403

### Requirement: Public Health Route Excludes Auth

The `/auth/health` endpoint MUST return HTTP 200 without any `Authorization` header and MUST NOT be affected by the global auth guard.

#### Scenario: Health check reachable without a token

- GIVEN the API is running
- WHEN `GET /auth/health` is called with no `Authorization` header
- THEN the system responds with HTTP 200

#### Scenario: Health check still 200 with an invalid token

- GIVEN the API is running
- WHEN `GET /auth/health` is called with an expired or malformed token
- THEN the system responds with HTTP 200
