import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { Public } from './public.decorator.js';

type Deps = ConstructorParameters<typeof JwtAuthGuard>;

const verify = vi.fn();
const resolve = vi.fn();

// A real Reflector so the tests exercise the decorator/guard combination itself.
const guard = new JwtAuthGuard(
  new Reflector(),
  { verify } as unknown as Deps[1],
  { resolve } as unknown as Deps[2],
);

interface FakeRequest {
  headers: Record<string, string | undefined>;
  user?: unknown;
}

const context = (
  handler: unknown,
  cls: unknown,
  headers: Record<string, string | undefined> = {},
): { ctx: ExecutionContext; request: FakeRequest } => {
  const request: FakeRequest = { headers };
  const ctx = {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
};

class OpenController {
  @Public()
  open(this: void) {}
}

class GuardedController {
  closed(this: void) {}
}

describe('JwtAuthGuard', () => {
  beforeEach(() => {
    verify.mockReset();
    resolve.mockReset();
  });

  it('lets an @Public() route through without touching the token', async () => {
    const { ctx } = context(OpenController.prototype.open, OpenController);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('authenticates a bearer token and attaches sub, appRole and businessId', async () => {
    verify.mockResolvedValue({ sub: 'user-1' });
    resolve.mockResolvedValue({ appRole: 'cashier', businessId: 'biz-1' });

    const { ctx, request } = context(GuardedController.prototype.closed, GuardedController, {
      authorization: 'Bearer a-token',
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('a-token');
    expect(resolve).toHaveBeenCalledWith('user-1');
    expect(request.user).toEqual({ sub: 'user-1', appRole: 'cashier', businessId: 'biz-1' });
  });

  it('accepts a lower-case bearer scheme', async () => {
    verify.mockResolvedValue({ sub: 'user-1' });
    resolve.mockResolvedValue({ appRole: 'admin', businessId: 'biz-1' });

    const { ctx } = context(GuardedController.prototype.closed, GuardedController, {
      authorization: 'bearer a-token',
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects a protected route with no Authorization header', async () => {
    const { ctx } = context(GuardedController.prototype.closed, GuardedController);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a non-bearer Authorization header', async () => {
    const { ctx } = context(GuardedController.prototype.closed, GuardedController, {
      authorization: 'Basic dXNlcjpwYXNz',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when token verification fails', async () => {
    verify.mockRejectedValue(new UnauthorizedException('authentication required'));
    const { ctx } = context(GuardedController.prototype.closed, GuardedController, {
      authorization: 'Bearer expired',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects when the user has no usable profile', async () => {
    verify.mockResolvedValue({ sub: 'user-1' });
    resolve.mockRejectedValue(new UnauthorizedException('authentication required'));
    const { ctx, request } = context(GuardedController.prototype.closed, GuardedController, {
      authorization: 'Bearer a-token',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });
});
