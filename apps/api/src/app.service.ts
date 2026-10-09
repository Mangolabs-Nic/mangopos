import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /**
   * Liveness, not readiness. Surfaces the most common wiring failure (a missing
   * DATABASE_URL) without pretending to have verified the database.
   */
  health() {
    return {
      status: 'ok',
      env: process.env.NODE_ENV ?? 'development',
      databaseConfigured: Boolean(process.env.DATABASE_URL),
    };
  }
}
