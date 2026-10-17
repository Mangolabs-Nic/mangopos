import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or a whole controller) as reachable without a bearer token.
 * `JwtAuthGuard` is global, so without this marker every route requires
 * authentication; the decorator is the explicit opt-out for connectivity and
 * health probes.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
