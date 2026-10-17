# Delta for auth-user-resolution

## ADDED Requirements

### Requirement: Profile Resolution by sub

After a token verifies, the system MUST look up the `profiles` row by the token's `sub` (user id) and read `role` and `business_id`. The resolved values MUST be exposed as `appRole` and `businessId` on the request user.

#### Scenario: Existing active profile resolves role and business

- GIVEN a verified token whose `sub` matches an active `profiles` row with role `cashier` and a `business_id`
- WHEN the system resolves the user for the request
- THEN `request.user.appRole` equals `cashier`
- AND `request.user.businessId` equals that row's `business_id`
- AND `request.user.sub` equals the token `sub`

### Requirement: Missing or Inactive Profile Rejected

If no `profiles` row matches the token's `sub`, or the matching row is inactive, the system MUST reject the request with HTTP 401.

#### Scenario: No matching profiles row returns 401

- GIVEN a verified token whose `sub` has no `profiles` row
- WHEN the system resolves the user
- THEN the system responds with HTTP 401

#### Scenario: Inactive profile returns 401

- GIVEN a verified token whose `sub` matches a `profiles` row with `active = false`
- WHEN the system resolves the user
- THEN the system responds with HTTP 401

### Requirement: Role Read Fresh Per Request

The system MUST read `profiles.role` from the database on every authenticated request and MUST NOT cache the role in the token or across requests. A demotion or promotion MUST affect the very next request without requiring a token refresh.

#### Scenario: Demotion applies to the next request

- GIVEN a user whose profile role is `admin` and holds a still-valid access token
- WHEN an admin demotes the profile to `cashier` and the user makes a new request with the same token
- THEN `request.user.appRole` equals `cashier`
- AND the outcome reflects the demoted role

#### Scenario: Promotion applies to the next request

- GIVEN a user with role `cashier` and a valid access token
- WHEN the profile role is changed to `supervisor` and a new request arrives with the same token
- THEN `request.user.appRole` equals `supervisor`
