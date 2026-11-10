import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  // /health is a normal route, so the global JwtAuthGuard protects it. The
  // public connectivity probe is /auth/health (see auth.e2e-spec.ts).
  it('/health (GET) requires authentication', () => {
    return request(app.getHttpServer()).get('/health').expect(401);
  });

  afterEach(async () => {
    await app.close();
  });
});
