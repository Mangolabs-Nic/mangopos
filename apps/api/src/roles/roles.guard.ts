import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isRole, type Role } from './role.js';
import { ROLES_KEY } from './roles.decorator.js';

/**
 * The principal authentication is expected to attach to the request. `appRole`
 * is the role mirrored by `public.profiles.role` — the same source the database
 * `current_role()` reads, so a demotion takes effect on the next request.
 *
 * It is deliberately NOT the Supabase JWT `role` claim: that claim carries the
 * *Postgres* role (`authenticated`), which says nothing about what the caller
 * may do. Nothing populates `appRole` yet, so a gated route currently answers
 * 401 rather than silently allowing through.
 */
export interface AuthenticatedRequest {
  user?: { appRole?: Role };
}

/**
 * Enforces `@Roles(...)`. Registered as a global guard; it only acts on routes
 * that opt in with the decorator.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @Roles at all: the route is not role-gated (authentication is a
    // separate concern). An empty list is a misconfiguration, not an opt-out —
    // @Roles() with no arguments already throws, so this only catches a list set
    // another way. Fail closed.
    if (required === undefined) return true;
    if (required.length === 0) throw new ForbiddenException('forbidden');

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) {
      // No principal at all: authentication, not authorisation, is missing.
      throw new UnauthorizedException('authentication required');
    }
    if (!isRole(user.appRole) || !required.includes(user.appRole)) {
      // A principal we cannot place is forbidden, not unauthenticated: answering
      // 401 here reads as an expired session and sends the client round the login
      // loop. The required roles go to the log, not the response, so a caller
      // cannot read the matrix off the error.
      this.logger.warn(`denied: appRole=${String(user.appRole)} required=${required.join(',')}`);
      throw new ForbiddenException('forbidden');
    }
    return true;
  }
}
