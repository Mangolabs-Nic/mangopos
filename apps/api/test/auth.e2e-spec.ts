import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

// The app reads its environment when the guard first runs, the same way main.ts
// loads the repo-root .env. The e2e run needs the local Supabase stack, so a
// missing file is not fatal here — the platform may supply the variables.
try {
  process.loadEnvFile('../../.env');
} catch {
  // Variables are expected to be present already.
}

const email = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
const password = 'password-1234';

describe('JwtAuthGuard (e2e)', () => {
  let app: INestApplication<App>;
  let admin: SupabaseClient;
  let userId: string;
  let businessId: string;
  let token: string;

  beforeAll(async () => {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !serviceKey || !anonKey || !process.env.DATABASE_URL) {
      throw new Error('e2e requires SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, DATABASE_URL');
    }

    admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user!.id;

    // The signup trigger already provisioned an admin profile and a business for
    // this user; read the business id so it can be cleaned up afterwards.
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query<{ business_id: string }>(
      'SELECT business_id FROM public.profiles WHERE id = $1',
      [userId],
    );
    await pool.end();
    businessId = rows[0]!.business_id;

    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await anon.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    token = signedIn.data.session!.access_token;

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    // Deleting the user cascades the profile; the business does not cascade.
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
    if (businessId && process.env.DATABASE_URL) {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      await pool.query('DELETE FROM public.businesses WHERE id = $1', [businessId]);
      await pool.end();
    }
  });

  it('serves the public health route without a token', async () => {
    const res = await request(app.getHttpServer()).get('/auth/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('rejects a protected route without a token', async () => {
    await request(app.getHttpServer()).get('/health').expect(401);
  });

  it('rejects a protected route with a malformed token', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
  });

  it('accepts a protected route with a valid Supabase token', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
