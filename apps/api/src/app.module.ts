import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { AppLogger, getAppLogger } from './common/app-logger.js';
import { RequestLogger } from './common/request-logger.js';
import { DiagnosticsController } from './diagnostics/diagnostics.controller.js';
import { RolesGuard } from './roles/roles.guard.js';

@Module({
  imports: [AuthModule],
  controllers: [AppController, DiagnosticsController],
  providers: [
    AppService,
    // The same instance NestFactory is given, so diagnostics covers boot logs too.
    { provide: AppLogger, useFactory: () => getAppLogger() },
    RequestLogger,
    // Auth runs first: it attaches request.user before any role check, and it
    // protects every route unless the route is marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global, but inert until a route opts in with @Roles(...).
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLogger).forRoutes('*');
  }
}
