import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/**
 * Reporting is read-only and has no providers of its own beyond the service:
 * the Supabase client is the one AuthModule already builds, so there is a
 * single timeout, a single set of credentials and one place to audit.
 */
@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
