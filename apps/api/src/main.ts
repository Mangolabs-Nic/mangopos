import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { getAppLogger } from './common/app-logger.js';
import { corsOptions } from './common/access-control.js';
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
  // One instance, shared with the DI provider: a second AppLogger would have its
  // own ring buffer and /diagnostics would miss whatever the other one logged.
  const logger = getAppLogger();

  const app = await NestFactory.create(AppModule, { logger });
  app.enableCors(corsOptions());

  // Unhandled rejections and exceptions must be visible, not silent.
  process.on('unhandledRejection', (reason) => {
    logger.write('error', 'unhandled_rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.write('fatal', 'uncaught_exception', { error });
    // The process state is undefined after an uncaught exception. Exiting lets the
    // orchestrator (Docker `restart: unless-stopped`, Railway) replace it; staying
    // alive means a corrupt process keeps serving requests.
    process.exit(1);
  });

  app.get(DiagnosticsController).warnMissingToken();

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  logger.write('log', 'server_started', { port, env: process.env.NODE_ENV ?? 'development' });
}
await bootstrap();
