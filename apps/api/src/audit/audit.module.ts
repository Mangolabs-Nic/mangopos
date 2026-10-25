import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppLogger, getAppLogger } from '../common/app-logger.js';
import { AuditService } from './audit.service.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { AUDIT_WRITER } from './audit-entry.js';
import { auditWriterFromEnv } from './audit-writer.factory.js';

/**
 * The API half of the audit trail.
 *
 * Registered as a global interceptor, like the roles guard: it is inert until a
 * request matches the policy, and a route added later is covered without having
 * to remember the module.
 */
@Module({
  providers: [
    // The process-wide singleton, the same instance AppModule hands to NestFactory.
    // A module cannot reach another module's providers, so it is resolved here too.
    { provide: AppLogger, useFactory: () => getAppLogger() },
    AuditService,
    {
      provide: AUDIT_WRITER,
      useFactory: (logger: AppLogger) => auditWriterFromEnv(logger),
      inject: [AppLogger],
    },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AuditModule {}
