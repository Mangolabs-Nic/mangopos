import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AppLogger } from './common/app-logger.js';
import { DiagnosticsController } from './diagnostics/diagnostics.controller.js';

// process.loadEnvFile() takes no path, so it reads .env from the current working
// directory: apps/api under the workspace scripts, /app/apps/api in the runtime
// image. In deployed environments the platform supplies the variables, so a
// missing file is expected rather than fatal.
try {
  process.loadEnvFile();
} catch {
  // no .env file - running on platform-provided environment
}

async function bootstrap() {
  const logger = new AppLogger();

  const app = await NestFactory.create(AppModule, { logger });
  app.useLogger(logger);
  app.enableCors();

  // Unhandled rejections and exceptions must be visible, not silent.
  process.on('unhandledRejection', (reason) => {
    logger.write('error', 'unhandled_rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.write('fatal', 'uncaught_exception', { error });
  });

  app.get(DiagnosticsController).warnMissingToken();

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  logger.write('log', 'server_started', { port, env: process.env.NODE_ENV ?? 'development' });
}
await bootstrap();
