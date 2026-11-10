import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../roles/roles.guard.js';
import { InactiveAccountError, JwtConfigError, JwtVerifier } from './jwt-verifier.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

/**
 * Authenticates every route except the ones marked `@Public()`.
 *
 * Global and fail-closed: a route added without a decorator requires a token.
 * It runs before `RolesGuard`, so that guard can trust `request.user`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { headers?: Record<string, unknown> }>();
    const header = request.headers?.authorization;
    const token =
      typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
        ? header.slice(7).trim()
        : null;

    if (!token) throw new UnauthorizedException('authentication required');

    try {
      const claims = await this.verifier.verify(token);
      request.user = {
        userId: claims.userId,
        businessId: claims.businessId,
        appRole: claims.appRole,
      };
      return true;
    } catch (error) {
      // A missing configuration is an outage, not a bad password: answering 401
      // would send every client into its login loop.
      if (error instanceof JwtConfigError) {
        throw new ServiceUnavailableException('authentication is not configured');
      }
      // Deactivated accounts are refused with 403: the token is valid, the
      // person is not allowed. A 401 reads as an expired session and loops.
      if (error instanceof InactiveAccountError) {
        throw new ForbiddenException('account is inactive');
      }
      throw new UnauthorizedException('invalid or expired session');
    }
  }
}
