# Delta for auth-jwt-verification

## ADDED Requirements

### Requirement: Bearer Token Extraction

The system MUST extract the access token from the `Authorization: Bearer <token>` header. Requests with an absent header, a non-Bearer scheme, or a malformed header MUST be rejected with HTTP 401.

#### Scenario: Valid Bearer header is accepted for verification

- GIVEN a request carries `Authorization: Bearer <token>`
- WHEN the auth guard processes the request
- THEN token verification proceeds with `<token>`

#### Scenario: Absent or malformed Authorization header returns 401

- GIVEN a request omits `Authorization` or uses a malformed value
- WHEN the auth guard processes the request
- THEN the system responds with HTTP 401
- AND the route handler is not executed

### Requirement: JWKS Signature Verification

The system MUST verify the token signature against the Supabase JWKS endpoint (`SUPABASE_URL/auth/v1/.well-known/jwks.json`). A token with an invalid signature or one that cannot be matched to a JWKS key MUST be rejected with HTTP 401.

#### Scenario: Valid signature passes verification

- GIVEN a token signed by the local Supabase JWT key
- WHEN the system verifies it against JWKS
- THEN verification succeeds and `sub` is extracted from the token

#### Scenario: Bad signature returns 401

- GIVEN a token with a signature not produced by the JWKS keys
- WHEN the system verifies it
- THEN the system responds with HTTP 401

### Requirement: Token Expiry Enforcement

The system MUST reject tokens whose `exp` claim is in the past with HTTP 401, regardless of signature validity.

#### Scenario: Expired token returns 401

- GIVEN a correctly signed token whose `exp` is in the past
- WHEN the system verifies it
- THEN the system responds with HTTP 401

#### Scenario: Token within validity window passes

- GIVEN a correctly signed token with `exp` in the future
- WHEN the system verifies it
- THEN verification succeeds

### Requirement: Issuer and Audience Enforcement

The system MUST enforce `iss` equal to `SUPABASE_URL/auth/v1` and `aud` equal to `authenticated`. A token with the wrong issuer or wrong audience MUST be rejected with HTTP 401.

#### Scenario: Wrong issuer returns 401

- GIVEN a correctly signed token with a non-Supabase `iss` claim
- WHEN the system verifies it
- THEN the system responds with HTTP 401

#### Scenario: Wrong audience returns 401

- GIVEN a correctly signed token with `aud` other than `authenticated`
- WHEN the system verifies it
- THEN the system responds with HTTP 401
