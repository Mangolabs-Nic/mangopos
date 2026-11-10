import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Liveness for authenticated callers. The unauthenticated probe is
   * `/auth/health`; this route stays behind the global guard on purpose.
   */
  @Get('health')
  health() {
    return this.appService.health();
  }
}
