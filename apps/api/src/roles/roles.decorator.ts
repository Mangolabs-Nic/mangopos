import { SetMetadata } from '@nestjs/common';
import type { Role } from './role.js';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route to the listed roles, enforced by `RolesGuard`. A route with
 * no `@Roles` is not role-checked — authentication is a separate concern.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
