import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '../roles/role.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { JwtVerificationService } from './jwt-verification.service.js';
import { ProfilesService } from './profiles.service.js';

/** The principal a request carries once the guard has authenticated it. */
export interface AuthenticatedUser {
  sub: string;
  appRole: Role;
  businessId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/** A single `Bearer <token>` credential; anything else is not a bearer token. */
const BEARER = /^Bearer (\S+)$/i;

/**
 * Global authentication guard. Every route requires a valid Supabase token
 * unless it is marked `@Public()`.
 *
 * On success it attaches `request.user` = `{ sub, appRole, businessId }`, which
 * `RolesGuard` consumes for role checks; the order of the two global guards in
 * `app.module.ts` is what guarantees the principal exists by then.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verification: JwtVerificationService,
    private readonly profiles: ProfilesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException('authentication required');

    const { sub } = await this.verification.verify(token);
    const { appRole, businessId } = await this.profiles.resolve(sub);
    request.user = { sub, appRole, businessId };
    return true;
  }
}
