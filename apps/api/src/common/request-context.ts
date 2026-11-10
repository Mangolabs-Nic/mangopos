import { UnauthorizedException } from '@nestjs/common';
import { bearerToken, type RequestWithAuthHeader } from '../auth/bearer.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

export interface AuthenticatedRequest extends RequestWithAuthHeader {
  user?: AuthenticatedUser;
}

/**
 * The verified caller and the raw token.
 *
 * The token is forwarded to PostgREST so RLS runs as `authenticated`; the
 * claims are used only for the values the API itself must write (business_id,
 * user_id) and for the role checks the guard already made.
 */
export function requestContext(request: AuthenticatedRequest): {
  token: string;
  user: AuthenticatedUser;
} {
  const token = bearerToken(request);
  const user = request.user;
  if (!token || !user) throw new UnauthorizedException('authentication required');
  return { token, user };
}
