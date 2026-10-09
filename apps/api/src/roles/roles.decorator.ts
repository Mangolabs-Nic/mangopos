import { SetMetadata } from '@nestjs/common';
import type { Role } from './role.js';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route to the listed roles, enforced by `RolesGuard`. A route with
 * no `@Roles` at all is not role-checked — authentication is a separate concern.
 *
 * `@Roles()` with no arguments is rejected outright: an empty requirement is
 * ambiguous, and a method-level empty list would override a class-level
 * restriction and open that route to everyone.
 */
export const Roles = (...roles: Role[]) => {
  if (roles.length === 0) {
    throw new Error('@Roles() requires at least one role');
  }
  return SetMetadata(ROLES_KEY, roles);
};
