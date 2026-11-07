import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppLogger } from '../common/app-logger.js';
import { AuditService } from './audit.service.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { AUDIT_WRITER } from './audit-entry.js';
import { auditWriterFromEnv } from './audit-writer.factory.js';

/**
 * The API half of the audit trail.
 *
 * Registered as a global interceptor, like the guards: it is inert until a
 * request matches the policy, and a route added later is covered without having
 * to remember the module.
 */
@Module({
  providers: [
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
