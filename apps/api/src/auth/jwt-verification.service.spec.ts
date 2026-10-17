import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// The public keys the mocked JWKS returns, keyed by the token's `kid`. Declared
// with vi.hoisted so the vi.mock factory below can close over them.
const jwks = vi.hoisted(() => ({ es256: '', rs256: '' }));

vi.mock('jwks-rsa', () => ({
  default: () => ({
    getSigningKey: async (kid?: string) => ({
      getPublicKey: () => (kid === 'rs256' ? jwks.rs256 : jwks.es256),
    }),
  }),
}));

import { JwtVerificationService } from './jwt-verification.service.js';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const AUDIENCE = 'authenticated';

const pem = (key: KeyObject): string => key.export({ type: 'spki', format: 'pem' }).toString();

// One Supabase-shaped ES256 (P-256) key pair and one legacy RS256 pair.
const es = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rs = generateKeyPairSync('rsa', { modulusLength: 2048 });
// A second EC key the JWKS never advertises: a token signed with it must fail.
const stranger = generateKeyPairSync('ec', { namedCurve: 'P-256' });

const signOptions = (kid: string, algorithm: 'ES256' | 'RS256'): Record<string, unknown> => ({
  algorithm,
  keyid: kid,
  issuer: ISSUER,
  audience: AUDIENCE,
});

const sign = (
  privateKey: KeyObject,
  kid: string,
  algorithm: 'ES256' | 'RS256',
  payload: Record<string, unknown> = { sub: 'user-1' },
): string =>
  new JwtService({ privateKey }).sign(payload, signOptions(kid, algorithm) as never);

describe('JwtVerificationService', () => {
  let service: JwtVerificationService;

  beforeAll(() => {
    jwks.es256 = pem(es.publicKey);
    jwks.rs256 = pem(rs.publicKey);
    process.env.SUPABASE_URL = SUPABASE_URL;
    service = new JwtVerificationService();
  });

  it('accepts a valid ES256 token and returns its subject', async () => {
    await expect(service.verify(sign(es.privateKey, 'es256', 'ES256'))).resolves.toEqual({
      sub: 'user-1',
    });
  });

  it('accepts a valid RS256 token', async () => {
    await expect(service.verify(sign(rs.privateKey, 'rs256', 'RS256'))).resolves.toEqual({
      sub: 'user-1',
    });
  });

  it('rejects a token whose signature does not match the signing key', async () => {
    // kid maps to the known ES256 public key, but the signature is from another key.
    await expect(service.verify(sign(stranger.privateKey, 'es256', 'ES256'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const expired = Math.floor(Date.now() / 1000) - 60;
    await expect(
      service.verify(sign(es.privateKey, 'es256', 'ES256', { sub: 'user-1', exp: expired })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token from another issuer', async () => {
    const token = new JwtService({ privateKey: es.privateKey }).sign(
      { sub: 'user-1' },
      { ...signOptions('es256', 'ES256'), issuer: 'http://evil.example/auth/v1' } as never,
    );
    await expect(service.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token for another audience', async () => {
    const token = new JwtService({ privateKey: es.privateKey }).sign(
      { sub: 'user-1' },
      { ...signOptions('es256', 'ES256'), audience: 'service_role' } as never,
    );
    await expect(service.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token with no subject claim', async () => {
    await expect(
      service.verify(sign(es.privateKey, 'es256', 'ES256', {})),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a malformed token', async () => {
    await expect(service.verify('not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
