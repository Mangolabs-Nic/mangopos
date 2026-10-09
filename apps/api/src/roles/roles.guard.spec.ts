import {
  ForbiddenException,
  SetMetadata,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { isRole, ROLES } from './role.js';
import { Roles, ROLES_KEY } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

// A real Reflector, so the tests exercise how the decorator and the guard
// actually combine — including the class-level vs method-level override.
const guard = new RolesGuard(new Reflector());

const context = (handler: unknown, cls: unknown, user?: unknown): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

@Roles('admin')
class AdminController {
  adminOnly(this: void) {}

  @Roles('cashier')
  cashierToo(this: void) {}
}

class OpenController {
  anything(this: void) {}
}

// Metadata set the way `@Roles()` would, but bypassing the decorator's guard, to
// prove the guard fails closed on an empty list however it got there.
class EmptyOverride {
  handler(this: void) {}
}
SetMetadata(ROLES_KEY, [])(
  EmptyOverride.prototype,
  'handler',
  Object.getOwnPropertyDescriptor(EmptyOverride.prototype, 'handler')!,
);

describe('@Roles', () => {
  it('rejects a call with no roles at runtime (untyped callers)', () => {
    const untyped = Roles as unknown as (...roles: unknown[]) => unknown;
    expect(() => untyped()).toThrow(/at least one role/);
  });
});

describe('RolesGuard', () => {
  it('allows a route that declares no roles at all', () => {
    expect(guard.canActivate(context(OpenController.prototype.anything, OpenController))).toBe(true);
  });

  it('allows a principal holding one of the required roles', () => {
    const ctx = context(AdminController.prototype.adminOnly, AdminController, { appRole: 'admin' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lets a method-level @Roles override the class-level one', () => {
    const ctx = context(AdminController.prototype.cashierToo, AdminController, { appRole: 'cashier' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('does not let an admin through a method that narrows to cashier', () => {
    const ctx = context(AdminController.prototype.cashierToo, AdminController, { appRole: 'admin' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('fails closed when the required list is empty', () => {
    const ctx = context(EmptyOverride.prototype.handler, EmptyOverride, { appRole: 'admin' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects with 401 when a gated route has no principal', () => {
    const ctx = context(AdminController.prototype.adminOnly, AdminController);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('rejects with 403 when the principal carries no app role', () => {
    const ctx = context(AdminController.prototype.adminOnly, AdminController, {});
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects with 403 when the app role is not a known role', () => {
    const ctx = context(AdminController.prototype.adminOnly, AdminController, { appRole: 'owner' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('ignores the Supabase JWT role claim', () => {
    // A JWT carries role: 'authenticated' (the Postgres role). It must never be
    // read as the app role.
    const ctx = context(AdminController.prototype.adminOnly, AdminController, {
      role: 'authenticated',
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects with 403 when the principal has the wrong role', () => {
    const ctx = context(AdminController.prototype.adminOnly, AdminController, { appRole: 'cashier' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

describe('isRole', () => {
  it('accepts exactly the database roles and nothing else', () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    expect(isRole('owner')).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(1)).toBe(false);
  });
});
