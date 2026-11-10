import { Global, Module } from '@nestjs/common';
import { AppLogger, getAppLogger } from './app-logger.js';

/**
 * One logger for the whole process.
 *
 * `getAppLogger()` is already a singleton, but a provider is still needed:
 * modules cannot reach each other's providers, and every feature module that
 * logs would otherwise re-declare the same factory. Global so `AuditModule`,
 * `AuthModule` and anything added later resolve the same instance NestFactory
 * was given.
 */
@Global()
@Module({
  providers: [{ provide: AppLogger, useFactory: () => getAppLogger() }],
  exports: [AppLogger],
})
export class LoggerModule {}
