import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

// process.loadEnvFile() takes no path, so it reads .env from the current working
// directory: apps/api under the workspace scripts, /app/apps/api in the runtime
// image. In deployed environments the platform supplies the variables, so a
// missing file is expected rather than fatal.
try {
  process.loadEnvFile();
} catch {
  // no .env file — running on platform-provided environment
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(process.env.PORT ?? 4000);
}
await bootstrap();
