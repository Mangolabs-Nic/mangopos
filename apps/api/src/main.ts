import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

// Local dev reads .env from the repo root. In deployed environments the platform
// supplies the variables, so a missing file is expected rather than fatal.
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
