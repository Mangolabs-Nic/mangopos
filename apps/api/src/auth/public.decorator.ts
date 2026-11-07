import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route out of the JWT guard.
 *
 * Only the routes that cannot have a session belong here: health, diagnostics
 * (which has its own token) and the login/recovery endpoints. Everything else is
 * protected by default, so forgetting a decorator fails closed rather than open.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
