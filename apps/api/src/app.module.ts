import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { LoggerModule } from './common/logger.module.js';
import { RequestLogger } from './common/request-logger.js';
import { DiagnosticsController } from './diagnostics/diagnostics.controller.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { RolesGuard } from './roles/roles.guard.js';
import { SalesModule } from './sales/sales.module.js';

@Module({
  imports: [
    LoggerModule,
    AuditModule,
    AuthModule,
    ReportsModule,
    SalesModule,
    InventoryModule,
    ExpensesModule,
  ],
  controllers: [AppController, DiagnosticsController],
  providers: [
    AppService,
    RequestLogger,
    // Order matters: authentication runs before authorisation, so RolesGuard
    // can trust request.user. Both are global; a route opts out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Inert until a route opts in with @Roles(...).
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLogger).forRoutes('*');
  }
}
