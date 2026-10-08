import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AppLogger } from './common/app-logger.js';
import { RequestLogger } from './common/request-logger.js';
import { DiagnosticsController } from './diagnostics/diagnostics.controller.js';

@Module({
  controllers: [AppController, DiagnosticsController],
  providers: [AppService, AppLogger, RequestLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLogger).forRoutes('*');
  }
}
