import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AppLogger, getAppLogger } from './common/app-logger.js';
import { RequestLogger } from './common/request-logger.js';
import { DiagnosticsController } from './diagnostics/diagnostics.controller.js';

@Module({
  controllers: [AppController, DiagnosticsController],
  providers: [
    AppService,
    // The same instance NestFactory is given, so diagnostics covers boot logs too.
    { provide: AppLogger, useFactory: () => getAppLogger() },
    RequestLogger,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLogger).forRoutes('*');
  }
}
