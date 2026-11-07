import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { JwtConfigError, JwtVerifier } from './jwt-verifier.js';

const SECRET = 'test-secret-with-at-least-32-characters-long';
const USER = '3f0c9b6e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const BUSINESS = '2a1b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';

async function token(
  claims: Record<string, unknown> = {},
  options: { secret?: string; expiresIn?: string } = {},
): Promise<string> {
  return new SignJWT({
    user_id: USER,
    business_id: BUSINESS,
    app_role: 'cashier',
    active: true,
    ...claims,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(USER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '1h')
    .sign(new TextEncoder().encode(options.secret ?? SECRET));
}

describe('JwtVerifier', () => {
  const verifier = new JwtVerifier({ SUPABASE_JWT_SECRET: SECRET });

  it('reads the claims the access-token hook adds', async () => {
    await expect(verifier.verify(await token())).resolves.toEqual({
      userId: USER,
      businessId: BUSINESS,
      appRole: 'cashier',
    });
  });

  it('rejects a token without a business_id', async () => {
    const missing = await token({ business_id: undefined });
    await expect(verifier.verify(missing)).rejects.toThrow(/business_id/);
  });

  it('rejects a user_id that contradicts sub', async () => {
    const contradicting = await token({ user_id: BUSINESS });
    await expect(verifier.verify(contradicting)).rejects.toThrow(/does not match/);
  });

  it('rejects an unknown role', async () => {
    await expect(verifier.verify(await token({ app_role: 'owner' }))).rejects.toThrow(/app_role/);
  });

  it('rejects an inactive profile', async () => {
    await expect(verifier.verify(await token({ active: false }))).rejects.toThrow(/active/);
  });

  it('rejects an expired token', async () => {
    await expect(verifier.verify(await token({}, { expiresIn: '-1m' }))).rejects.toThrow();
  });

  it('rejects a token signed with another secret', async () => {
    const forged = await token({}, { secret: 'another-secret-with-at-least-32-chars' });
    await expect(verifier.verify(forged)).rejects.toThrow();
  });

  it('fails closed when it has no key to verify with', async () => {
    const unconfigured = new JwtVerifier({});
    expect(unconfigured.configured).toBe(false);
    await expect(unconfigured.verify(await token())).rejects.toBeInstanceOf(JwtConfigError);
  });

  it('uses the JWKS URL when no shared secret is set', () => {
    const verifierWithJwks = new JwtVerifier({ SUPABASE_URL: 'https://db.example.test' });
    expect(verifierWithJwks.configured).toBe(true);
  });

  it('prefers the JWKS over a shared secret when both are configured', () => {
    // A current Supabase project signs with ES256; verifying HS256 against the
    // legacy secret would reject every real token.
    const verifierWithJwks = new JwtVerifier({
      SUPABASE_URL: 'https://db.example.test',
      SUPABASE_JWT_SECRET: SECRET,
    });
    expect(verifierWithJwks.configured).toBe(true);
  });
});
