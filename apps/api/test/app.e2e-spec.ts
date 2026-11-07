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

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
        expect(res.body.databaseConfigured).toBeTypeOf('boolean');
      });
  });

  it('/auth/me without a token is refused', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('/auth/login without credentials is a client error, not an upstream call', () => {
    return request(app.getHttpServer()).post('/auth/login').send({}).expect(400);
  });

  afterEach(async () => {
    await app.close();
  });
});
