import { Controller, Get } from '@nestjs/common';
import { Public } from './public.decorator.js';

/**
 * Authentication surface. Kept deliberately tiny: the guard and the Supabase
 * token are the feature, not an app-managed login.
 */
@Controller('auth')
export class AuthController {
  /**
   * Public connectivity probe. The global guard protects everything else, so a
   * probe must be able to answer without a token (load balancers, docker
   * healthchecks, local smoke tests).
   */
  @Get('health')
  @Public()
  health() {
    return { status: 'ok' };
  }
}
