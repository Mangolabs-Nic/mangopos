import {
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLogger } from '../common/app-logger.js';
import type { AuthenticatedUser, SupabaseSession } from './auth.types.js';
import { AuthService } from './auth.service.js';
import type { JwtVerifier } from './jwt-verifier.js';
import { addressHash, pinLookup } from './pin.js';
import { SupabaseAuthError } from './supabase-auth.client.js';

const PEPPER = 'pepper-for-tests-0123456789';
const USER = '3f0c9b6e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const BUSINESS = '2a1b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const PIN = '4821';

const actor: AuthenticatedUser = { userId: USER, businessId: BUSINESS, appRole: 'cashier' };
const session: SupabaseSession = {
  access_token: 'access',
  refresh_token: 'refresh',
  expires_in: 3600,
  token_type: 'bearer',
};

function harness() {
  const client = {
    passwordSession: vi.fn(),
    magicLinkSession: vi.fn(),
    sendRecovery: vi.fn(),
    updatePassword: vi.fn(),
    logout: vi.fn(),
    createUser: vi.fn(),
    deleteUser: vi.fn(),
    rpc: vi.fn(),
    profileInBusiness: vi.fn(),
  };
  const verifier = { verify: vi.fn() };
  const logger = { write: vi.fn() };
  const service = new AuthService(
    client as never,
    verifier as unknown as JwtVerifier,
    logger as unknown as AppLogger,
  );
  return { service, client, verifier, logger };
}

beforeEach(() => {
  vi.stubEnv('PIN_PEPPER', PEPPER);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('login', () => {
  it('returns the Supabase session and the actor from its claims', async () => {
    const { service, client, verifier } = harness();
    client.passwordSession.mockResolvedValue(session);
    verifier.verify.mockResolvedValue(actor);

    await expect(service.login('Ana@Example.com', 'secret123')).resolves.toEqual({ session, actor });
    expect(client.passwordSession).toHaveBeenCalledWith('ana@example.com', 'secret123');
    expect(verifier.verify).toHaveBeenCalledWith('access');
  });

  it('rejects a malformed email before calling Supabase', async () => {
    const { service, client } = harness();
    await expect(service.login('nope', 'secret123')).rejects.toThrow(/email/);
    expect(client.passwordSession).not.toHaveBeenCalled();
  });

  it('turns a rejected credential into 401', async () => {
    const { service, client } = harness();
    client.passwordSession.mockRejectedValue(new SupabaseAuthError(400, 'invalid_grant'));
    await expect(service.login('ana@example.com', 'wrong-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('fails closed when the token has no tenant claims', async () => {
    const { service, client, verifier } = harness();
    client.passwordSession.mockResolvedValue(session);
    verifier.verify.mockRejectedValue(new Error('token is missing a valid business_id claim'));

    await expect(service.login('ana@example.com', 'secret123')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('pinLogin', () => {
  it('resolves the PIN to an email and exchanges it for a session', async () => {
    const { service, client, verifier } = harness();
    client.rpc.mockResolvedValue({ status: 'ok', user_id: USER, email: 'emp@example.com' });
    client.magicLinkSession.mockResolvedValue(session);
    verifier.verify.mockResolvedValue(actor);

    await expect(service.pinLogin(' Mi-Tienda ', PIN, '203.0.113.9')).resolves.toEqual({
      session,
      actor,
    });

    expect(client.rpc).toHaveBeenCalledWith('employee_pin_login', {
      p_business_slug: 'mi-tienda',
      p_pin_lookup: pinLookup(PIN, PEPPER),
      p_ip_hash: addressHash('203.0.113.9', PEPPER),
    });
    expect(client.magicLinkSession).toHaveBeenCalledWith('emp@example.com');
  });

  it('does not put the PIN in the RPC arguments', async () => {
    const { service, client, verifier } = harness();
    client.rpc.mockResolvedValue({ status: 'invalid' });
    await expect(service.pinLogin('mi-tienda', PIN, undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const args = client.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args).not.toHaveProperty('pin');
    expect(args.p_pin_lookup).toMatch(/^[0-9a-f]{64}$/);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('answers 429 while locked, with the retry window', async () => {
    const { service, client } = harness();
    client.rpc.mockResolvedValue({ status: 'locked', retry_after_seconds: 120 });

    const error = await service.pinLogin('mi-tienda', PIN, undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toMatchObject({ retry_after_seconds: 120 });
  });

  it('refuses an invalid PIN', async () => {
    const { service, client } = harness();
    client.rpc.mockResolvedValue({ status: 'invalid' });
    await expect(service.pinLogin('mi-tienda', PIN, undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('fails closed without a pepper', async () => {
    vi.stubEnv('PIN_PEPPER', '');
    const { service, client } = harness();
    await expect(service.pinLogin('mi-tienda', PIN, undefined)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('refuses a session that belongs to another account than the PIN resolved', async () => {
    const { service, client, verifier, logger } = harness();
    client.rpc.mockResolvedValue({ status: 'ok', user_id: USER, email: 'emp@example.com' });
    client.magicLinkSession.mockResolvedValue(session);
    verifier.verify.mockResolvedValue({ ...actor, userId: BUSINESS });

    await expect(service.pinLogin('mi-tienda', PIN, undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(logger.write).toHaveBeenCalledWith('error', 'pin_session_mismatch', expect.anything());
  });
});

describe('recovery', () => {
  it('never reveals whether the address exists', async () => {
    const { service, client } = harness();
    client.sendRecovery.mockRejectedValue(new SupabaseAuthError(422, 'user_not_found'));

    await expect(service.recover('ana@example.com')).resolves.toBeUndefined();
    await expect(service.recover('not-an-email')).resolves.toBeUndefined();
  });

  it('surfaces a rate limit', async () => {
    const { service, client } = harness();
    client.sendRecovery.mockRejectedValue(new SupabaseAuthError(429, 'over_email_send_rate_limit'));
    await expect(service.recover('ana@example.com')).rejects.toBeInstanceOf(HttpException);
  });

  it('rejects an expired recovery link', async () => {
    const { service, client } = harness();
    client.updatePassword.mockRejectedValue(new SupabaseAuthError(401, 'bad_jwt'));
    await expect(service.confirmRecovery('token', 'new-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('createEmployee', () => {
  it('creates the user, provisions the profile and sets the PIN', async () => {
    const { service, client } = harness();
    client.createUser.mockResolvedValue({ id: USER, email: 'emp@example.com' });
    client.rpc.mockResolvedValue({});

    await expect(
      service.createEmployee(
        { ...actor, appRole: 'admin' },
        { email: 'Emp@Example.com', password: 'secret123', role: 'cashier', pin: PIN },
      ),
    ).resolves.toEqual({ user_id: USER, email: 'emp@example.com', role: 'cashier' });

    expect(client.rpc).toHaveBeenNthCalledWith(1, 'provision_user_for_business', {
      target_user_id: USER,
      target_business: BUSINESS,
      target_role: 'cashier',
    });
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'set_employee_pin', {
      p_user_id: USER,
      p_pin_lookup: pinLookup(PIN, PEPPER),
    });
  });

  it('removes the auth user when provisioning fails', async () => {
    const { service, client } = harness();
    client.createUser.mockResolvedValue({ id: USER, email: 'emp@example.com' });
    client.rpc.mockRejectedValue(new SupabaseAuthError(400, 'bad_request'));

    await expect(
      service.createEmployee(
        { ...actor, appRole: 'admin' },
        { email: 'emp@example.com', password: 'secret123', role: 'cashier', pin: PIN },
      ),
    ).rejects.toBeDefined();
    expect(client.deleteUser).toHaveBeenCalledWith(USER);
  });

  it('reports a duplicate PIN as a conflict and rolls the user back', async () => {
    const { service, client } = harness();
    client.createUser.mockResolvedValue({ id: USER, email: 'emp@example.com' });
    client.rpc
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new SupabaseAuthError(409, '23505'));

    await expect(
      service.createEmployee(
        { ...actor, appRole: 'admin' },
        { email: 'emp@example.com', password: 'secret123', role: 'cashier', pin: PIN },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(client.deleteUser).toHaveBeenCalledWith(USER);
  });

  it('rejects an unknown role and a weak PIN before creating anything', async () => {
    const { service, client } = harness();
    await expect(
      service.createEmployee(
        { ...actor, appRole: 'admin' },
        { email: 'emp@example.com', password: 'secret123', role: 'owner', pin: PIN },
      ),
    ).rejects.toThrow(/role/);
    await expect(
      service.createEmployee(
        { ...actor, appRole: 'admin' },
        { email: 'emp@example.com', password: 'secret123', role: 'cashier', pin: '12' },
      ),
    ).rejects.toThrow(/PIN/);
    expect(client.createUser).not.toHaveBeenCalled();
  });
});

describe('setPin', () => {
  it('refuses an employee from another business', async () => {
    const { service, client } = harness();
    client.profileInBusiness.mockResolvedValue(false);

    await expect(service.setPin(actor, USER, PIN)).rejects.toBeInstanceOf(NotFoundException);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('reports a PIN already used in the business', async () => {
    const { service, client } = harness();
    client.profileInBusiness.mockResolvedValue(true);
    client.rpc.mockRejectedValue(new SupabaseAuthError(409, '23505'));

    await expect(service.setPin(actor, USER, PIN)).rejects.toBeInstanceOf(ConflictException);
  });
});
