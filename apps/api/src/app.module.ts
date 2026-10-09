import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AppLogger, getAppLogger } from './common/app-logger.js';
import { RequestLogger } from './common/request-logger.js';
import { DiagnosticsController } from './diagnostics/diagnostics.controller.js';
import { RolesGuard } from './roles/roles.guard.js';

@Module({
  controllers: [AppController, DiagnosticsController],
  providers: [
    AppService,
    // The same instance NestFactory is given, so diagnostics covers boot logs too.
    { provide: AppLogger, useFactory: () => getAppLogger() },
    RequestLogger,
    // Global, but inert until a route opts in with @Roles(...).
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLogger).forRoutes('*');
  }
}
