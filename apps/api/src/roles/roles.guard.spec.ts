import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { isRole, type Role } from './role.js';
import { RolesGuard } from './roles.guard.js';

const reflector = (required?: Role[]): Reflector =>
  ({ getAllAndOverride: () => required }) as unknown as Reflector;

const context = (user?: { role?: unknown }): ExecutionContext =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const guard = (required?: Role[]) => new RolesGuard(reflector(required));

describe('RolesGuard', () => {
  it('allows any request when the route declares no roles', () => {
    expect(guard().canActivate(context())).toBe(true);
    expect(guard([]).canActivate(context())).toBe(true);
  });

  it('allows a principal holding one of the required roles', () => {
    expect(guard(['admin', 'supervisor']).canActivate(context({ role: 'supervisor' }))).toBe(true);
  });

  it('rejects with 401 when a gated route has no principal', () => {
    expect(() => guard(['admin']).canActivate(context())).toThrow(UnauthorizedException);
  });

  it('rejects with 401 when the attached role is not a known role', () => {
    expect(() => guard(['admin']).canActivate(context({ role: 'owner' }))).toThrow(UnauthorizedException);
  });

  it('rejects with 403 when the principal has the wrong role', () => {
    expect(() => guard(['admin']).canActivate(context({ role: 'cashier' }))).toThrow(ForbiddenException);
  });
});

describe('isRole', () => {
  it('accepts exactly the three database roles', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('supervisor')).toBe(true);
    expect(isRole('cashier')).toBe(true);
    expect(isRole('owner')).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(1)).toBe(false);
  });
});
