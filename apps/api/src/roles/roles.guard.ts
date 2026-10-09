import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isRole, type Role } from './role.js';
import { ROLES_KEY } from './roles.decorator.js';

/**
 * The principal the authentication work is expected to attach to the request
 * before this guard runs. Nothing sets it yet, so a role-gated route currently
 * answers 401 rather than silently allowing through.
 */
export interface AuthenticatedRequest {
  user?: { role?: Role };
}

/**
 * Enforces `@Roles(...)`. Registered as a global guard; it only acts on routes
 * that opt in with the decorator.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;
    if (!isRole(role)) {
      // No usable principal: authentication, not authorisation, is missing.
      throw new UnauthorizedException('authentication required');
    }
    if (!required.includes(role)) {
      throw new ForbiddenException(`this action requires role: ${required.join(' or ')}`);
    }
    return true;
  }
}
