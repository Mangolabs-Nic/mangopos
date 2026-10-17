import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import jwksClient from 'jwks-rsa';

type JwksClient = ReturnType<typeof jwksClient>;

/** Algorithms Supabase signing keys use today: RS256 (legacy) and ES256 (P-256). */
const ALGORITHMS = ['RS256', 'ES256'] as const;

/** Supabase always issues access tokens with the Postgres `authenticated` role. */
const AUDIENCE = 'authenticated';

export interface JwtPayload {
  sub: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
}

/**
 * Verifies a Supabase access token against the project's public JWKS.
 *
 * The public key is fetched from the JWKS endpoint (never shared as a secret),
 * selected by the token's `kid`, and cached by `jwks-rsa`. The token is only
 * accepted when its signature, `iss` and `aud` all check out; anything else is
 * an authentication failure, surfaced as 401.
 *
 * Env is read lazily so importing this service never depends on configuration:
 * a missing `SUPABASE_URL` simply makes every verification fail closed.
 */
@Injectable()
export class JwtVerificationService {
  private jwt?: JwtService;
  private client?: JwksClient;

  async verify(token: string): Promise<{ sub: string }> {
    try {
      const payload = await this.jwtService().verifyAsync<JwtPayload>(token, {
        algorithms: [...ALGORITHMS],
        issuer: this.issuer(),
        audience: AUDIENCE,
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new Error('token has no subject');
      }
      return { sub: payload.sub };
    } catch {
      // Do not leak the verification failure mode (expired vs bad signature vs
      // wrong issuer): the client only learns the token was not usable.
      throw new UnauthorizedException('authentication required');
    }
  }

  private issuer(): string {
    return `${process.env.SUPABASE_URL ?? ''}/auth/v1`;
  }

  private jwksUri(): string {
    // Supabase's discovery document advertises the JWKS at this path; the bare
    // `/auth/v1/jwks` path some docs mention answers 404.
    return (
      process.env.SUPABASE_JWKS_URL ??
      `${process.env.SUPABASE_URL ?? ''}/auth/v1/.well-known/jwks.json`
    );
  }

  private jwtService(): JwtService {
    return (this.jwt ??= new JwtService({
      secretOrKeyProvider: (_requestType, tokenOrPayload) => {
        // Only verification ever runs here; signing would hand over an object.
        if (typeof tokenOrPayload !== 'string') {
          throw new Error('expected a raw token string');
        }
        return this.resolveKey(tokenOrPayload);
      },
    }));
  }

  private jwks(): JwksClient {
    return (this.client ??= jwksClient({
      jwksUri: this.jwksUri(),
      cache: true,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    }));
  }

  private async resolveKey(token: string): Promise<string | Buffer> {
    const decoded = this.jwtService().decode<{ header?: { kid?: string } }>(token, {
      complete: true,
    });
    const signingKey = await this.jwks().getSigningKey(decoded?.header?.kid);
    return signingKey.getPublicKey();
  }
}
