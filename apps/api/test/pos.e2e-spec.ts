import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

try {
  process.loadEnvFile('../../.env');
} catch {
  // Variables are expected to be present already.
}

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const adminEmail = `pos-admin-${stamp}@example.com`;
const cashierEmail = `pos-cashier-${stamp}@example.com`;
const password = 'password-1234';
const pin = '4821';

// The report range is interpreted in the business timezone, so "today" is asked
// in that zone instead of trusting the machine clock.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua' }).format(new Date());

describe('Sales, inventory and expenses (e2e)', () => {
  let app: INestApplication<App>;
  let service: SupabaseClient;
  let adminId: string | null = null;
  let cashierId: string | null = null;
  let businessId: string | null = null;
  let adminToken: string;
  let cashierToken: string;
  let productId: string;
  let saleId: string;

  const asAdmin = () => ({ Authorization: `Bearer ${adminToken}` });
  const asCashier = () => ({ Authorization: `Bearer ${cashierToken}` });

  beforeAll(async () => {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !serviceKey || !anonKey || !process.env.DATABASE_URL) {
      throw new Error('e2e requires SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, DATABASE_URL');
    }

    service = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const created = await service.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    adminId = created.data.user!.id;

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query<{ business_id: string }>(
      'SELECT business_id FROM public.profiles WHERE id = $1',
      [adminId],
    );
    await pool.end();
    businessId = rows[0]!.business_id;

    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await anon.auth.signInWithPassword({ email: adminEmail, password });
    if (signedIn.error) throw signedIn.error;
    adminToken = signedIn.data.session!.access_token;

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (service) {
      if (cashierId) await service.auth.admin.deleteUser(cashierId);
      if (adminId) await service.auth.admin.deleteUser(adminId);
    }
    if (businessId && process.env.DATABASE_URL) {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      await pool.query('DELETE FROM public.businesses WHERE id = $1', [businessId]);
      await pool.end();
    }
  });

  it('creates a product with stock', async () => {
    const response = await request(app.getHttpServer())
      .post('/inventory')
      .set(asAdmin())
      .send({ name: 'Café molido', price: '10.00', cost: '4.00', stock: 5 })
      .expect(201);

    expect(response.body).toMatchObject({ name: 'Café molido', stock: 5, price: 10 });
    productId = response.body.id;

    await request(app.getHttpServer())
      .get(`/inventory/${productId}`)
      .set(asAdmin())
      .expect(200);
  });

  it('records a sale from the catalogue price and deducts stock', async () => {
    const response = await request(app.getHttpServer())
      .post('/sales')
      .set(asAdmin())
      .send({ items: [{ product_id: productId, quantity: 2 }], tax: '0.50' })
      .expect(201);

    expect(response.body).toMatchObject({ subtotal: 20, tax: 0.5, total: 20.5, status: 'completed' });
    expect(response.body.sale_items).toHaveLength(1);
    expect(response.body.sale_items[0]).toMatchObject({ quantity: 2, unit_price: 10 });
    saleId = response.body.id;

    const product = await request(app.getHttpServer())
      .get(`/inventory/${productId}`)
      .set(asAdmin())
      .expect(200);
    expect(product.body.stock).toBe(3);
  });

  it('reports the sale it just recorded', async () => {
    const response = await request(app.getHttpServer())
      .get(`/reports/sales?from=${today}&to=${today}`)
      .set(asAdmin())
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    const total = response.body.reduce((sum: number, row: { total: number }) => sum + Number(row.total), 0);
    expect(total).toBeGreaterThanOrEqual(20.5);
  });

  it('refuses a sale the stock cannot cover', async () => {
    await request(app.getHttpServer())
      .post('/sales')
      .set(asAdmin())
      .send({ items: [{ product_id: productId, quantity: 50 }] })
      .expect(409);
  });

  it('voids the sale and returns the units', async () => {
    const response = await request(app.getHttpServer())
      .post(`/sales/${saleId}/void`)
      .set(asAdmin())
      .send({ reason: 'test void' })
      .expect(200);

    expect(response.body).toMatchObject({ status: 'voided', void_reason: 'test void' });

    const product = await request(app.getHttpServer())
      .get(`/inventory/${productId}`)
      .set(asAdmin())
      .expect(200);
    expect(product.body.stock).toBe(5);

    await request(app.getHttpServer())
      .post(`/sales/${saleId}/void`)
      .set(asAdmin())
      .send({ reason: 'again' })
      .expect(409);
  });

  it('records a stock adjustment as a movement', async () => {
    const response = await request(app.getHttpServer())
      .post('/inventory/adjust')
      .set(asAdmin())
      .send({ product_id: productId, adjustment: -1, reason: 'breakage' })
      .expect(201);

    expect(response.body).toMatchObject({
      adjustment: -1,
      quantity_before: 5,
      quantity_after: 4,
      reason: 'breakage',
    });

    const product = await request(app.getHttpServer())
      .get(`/inventory/${productId}`)
      .set(asAdmin())
      .expect(200);
    expect(product.body.stock).toBe(4);
  });

  it('records, corrects and deletes an expense', async () => {
    const created = await request(app.getHttpServer())
      .post('/expenses')
      .set(asAdmin())
      .send({ amount: '12.34', category: 'renta', description: 'local' })
      .expect(201);

    const expenseId = created.body.id;
    expect(created.body).toMatchObject({ amount: 12.34, category: 'renta' });

    const listed = await request(app.getHttpServer()).get('/expenses').set(asAdmin()).expect(200);
    expect(listed.body.some((row: { id: string }) => row.id === expenseId)).toBe(true);

    const updated = await request(app.getHttpServer())
      .put(`/expenses/${expenseId}`)
      .set(asAdmin())
      .send({ amount: '20.00' })
      .expect(200);
    expect(updated.body.amount).toBe(20);

    await request(app.getHttpServer()).delete(`/expenses/${expenseId}`).set(asAdmin()).expect(200);
  });

  it('lets a cashier sell but not manage the catalogue, void or read expenses', async () => {
    const employee = await request(app.getHttpServer())
      .post('/auth/employees')
      .set(asAdmin())
      .send({ email: cashierEmail, password, role: 'cashier', pin })
      .expect(201);
    cashierId = employee.body.user_id;

    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await anon.auth.signInWithPassword({ email: cashierEmail, password });
    if (signedIn.error) throw signedIn.error;
    cashierToken = signedIn.data.session!.access_token;

    const sale = await request(app.getHttpServer())
      .post('/sales')
      .set(asCashier())
      .send({ items: [{ product_id: productId, quantity: 1 }] })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/inventory/${productId}`)
      .set(asCashier())
      .send({ price: '1.00' })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/sales/${sale.body.id}/void`)
      .set(asCashier())
      .send({ reason: 'nope' })
      .expect(403);

    await request(app.getHttpServer()).get('/expenses').set(asCashier()).expect(403);
    await request(app.getHttpServer()).get('/sales').set(asCashier()).expect(200);
  });
});
