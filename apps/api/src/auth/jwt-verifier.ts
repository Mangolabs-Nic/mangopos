import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { isRole } from '../roles/role.js';
import type { AuthenticatedUser } from './auth.types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Configuration failure, told apart from a bad token so the guard can answer 503. */
export class JwtConfigError extends Error {}

/** A valid token for a profile that is no longer active; the guard answers 403. */
export class InactiveAccountError extends Error {}

/**
 * Verifies Supabase access tokens and reads the claims the access-token hook adds.
 *
 * The project's JWKS is the default, because a current Supabase project signs with
 * asymmetric keys even locally (the local stack issues ES256). The shared HS256
 * secret is only a fallback for a project with no `SUPABASE_URL`; using it against
 * an ES256 project would reject every real token.
 *
 * The token is only a session if it carries `user_id`, `business_id`, `app_role`
 * and `active`. A token minted before the hook was enabled has none of them and
 * is rejected, which is the honest outcome: the API cannot place a caller it
 * cannot attribute to a tenant.
 */
export class JwtVerifier {
  private readonly key: Uint8Array | JWTVerifyGetKey | null;
  private readonly algorithms: string[];

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const url = env.SUPABASE_URL?.trim();
    if (url) {
      this.key = createRemoteJWKSet(
        new URL(`${url.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`),
      );
      this.algorithms = ['ES256', 'RS256'];
      return;
    }

    const secret = env.SUPABASE_JWT_SECRET?.trim();
    if (secret) {
      this.key = new TextEncoder().encode(secret);
      this.algorithms = ['HS256'];
      return;
    }

    this.key = null;
    this.algorithms = [];
  }

  get configured(): boolean {
    return this.key !== null;
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    if (!this.key) {
      throw new JwtConfigError('no SUPABASE_JWT_SECRET and no SUPABASE_URL to fetch JWKS from');
    }

    // Throws on a bad signature, an expired token, a wrong issuer or a wrong
    // audience. The caller only learns "not authenticated".
    const { payload } = await jwtVerify(token, this.key, {
      algorithms: this.algorithms,
      audience: 'authenticated',
    });

    const userId = typeof payload.user_id === 'string' ? payload.user_id : payload.sub;
    if (!userId || (payload.sub && payload.user_id && payload.sub !== payload.user_id)) {
      throw new Error('token user_id does not match sub');
    }

    const businessId = payload.business_id;
    if (typeof businessId !== 'string' || !UUID.test(businessId)) {
      throw new Error('token is missing a valid business_id claim');
    }

    if (!isRole(payload.app_role)) {
      throw new Error('token is missing a valid app_role claim');
    }

    if (payload.active !== true) {
      throw new InactiveAccountError('token does not carry an active profile');
    }

    return { userId, businessId, appRole: payload.app_role };
  }
}
