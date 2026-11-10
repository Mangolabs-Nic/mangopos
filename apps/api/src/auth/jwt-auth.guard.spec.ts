import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { Public } from './public.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { InactiveAccountError, JwtConfigError, type JwtVerifier } from './jwt-verifier.js';

const claims = {
  userId: '3f0c9b6e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
  businessId: '2a1b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d',
  appRole: 'cashier' as const,
};

function harness(result: unknown) {
  const verify = vi.fn().mockResolvedValue(result);
  const guard = new JwtAuthGuard(new Reflector(), { verify } as unknown as JwtVerifier);
  return { guard, verify };
}

const context = (
  handler: unknown,
  cls: object,
  request: Record<string, unknown>,
): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

class Open {
  @Public()
  health(this: void) {}

  guarded(this: void) {}
}

@Public()
class PublicController {
  anything(this: void) {}
}

describe('JwtAuthGuard', () => {
  it('lets a public route through without a token', async () => {
    const { guard, verify } = harness(claims);
    await expect(
      guard.canActivate(context(Open.prototype.health, Open, { headers: {} })),
    ).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('lets a public controller through', async () => {
    const { guard } = harness(claims);
    await expect(
      guard.canActivate(context(PublicController.prototype.anything, PublicController, { headers: {} })),
    ).resolves.toBe(true);
  });

  it('refuses a guarded route with no bearer token', async () => {
    const { guard } = harness(claims);
    await expect(
      guard.canActivate(context(Open.prototype.guarded, Open, { headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the verified claims to the request', async () => {
    const { guard } = harness(claims);
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer token-1' },
    };

    await expect(
      guard.canActivate(context(Open.prototype.guarded, Open, request)),
    ).resolves.toBe(true);
    expect(request.user).toEqual(claims);
  });

  it('answers 503 when verification is not configured', async () => {
    const verify = vi.fn().mockRejectedValue(new JwtConfigError('no key'));
    const guard = new JwtAuthGuard(new Reflector(), { verify } as unknown as JwtVerifier);

    await expect(
      guard.canActivate(
        context(Open.prototype.guarded, Open, { headers: { authorization: 'Bearer t' } }),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('answers 403 for a deactivated account', async () => {
    const verify = vi.fn().mockRejectedValue(new InactiveAccountError('inactive'));
    const guard = new JwtAuthGuard(new Reflector(), { verify } as unknown as JwtVerifier);

    await expect(
      guard.canActivate(
        context(Open.prototype.guarded, Open, { headers: { authorization: 'Bearer t' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 401 for an invalid token', async () => {
    const verify = vi.fn().mockRejectedValue(new Error('signature verification failed'));
    const guard = new JwtAuthGuard(new Reflector(), { verify } as unknown as JwtVerifier);

    await expect(
      guard.canActivate(
        context(Open.prototype.guarded, Open, { headers: { authorization: 'Bearer t' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
