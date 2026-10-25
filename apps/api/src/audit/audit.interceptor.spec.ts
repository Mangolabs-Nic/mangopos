import { HttpException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AppLogger } from '../common/app-logger.js';
import { Audit } from './audit.decorator.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { AuditService } from './audit.service.js';
import type { AuditEntry } from './audit-entry.js';

const SALE_ID = '3f0c9b6e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

function harness(handler?: unknown, cls: object = OpenController) {
  const write = vi.fn<(entry: AuditEntry) => Promise<void>>().mockResolvedValue(undefined);
  const log = vi.fn();
  const writer = { write };
  const logger = { write: log } as unknown as AppLogger;
  const interceptor = new AuditInterceptor(new Reflector(), new AuditService(writer, logger));

  const context = (request: Record<string, unknown>): ExecutionContext =>
    ({
      getHandler: () => handler ?? (cls as { prototype: { handler: unknown } }).prototype.handler,
      getClass: () => cls,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ statusCode: request.__status ?? 200 }),
      }),
    }) as unknown as ExecutionContext;

  const next = (result: unknown = of({ ok: true })): CallHandler => ({
    handle: () => result as ReturnType<CallHandler['handle']>,
  });

  const recorded = async (): Promise<AuditEntry> => {
    await vi.waitFor(() => expect(write).toHaveBeenCalled());
    return write.mock.calls[0][0];
  };

  return { interceptor, write, log, context, next, recorded };
}

class OpenController {
  handler(this: void) {}
}

class DecoratedController {
  @Audit({ action: 'sales.void', entity: 'sales', sensitive: true })
  cancel(this: void) {}
}

describe('AuditInterceptor', () => {
  it('records nothing for a read', async () => {
    const { interceptor, write, context, next } = harness();
    await lastValueFrom(interceptor.intercept(context({ method: 'GET', path: '/sales' }), next()));
    expect(write).not.toHaveBeenCalled();
  });

  it('records nothing for a routine write the trigger already covers', async () => {
    const { interceptor, write, context, next } = harness();
    await lastValueFrom(
      interceptor.intercept(
        context({ method: 'POST', path: '/products', body: { name: 'x' } }),
        next(),
      ),
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('records a delete with its entity and the sensitive flag', async () => {
    const { interceptor, context, next, recorded } = harness();
    await lastValueFrom(
      interceptor.intercept(
        context({ method: 'DELETE', path: `/products/${SALE_ID}`, params: { id: SALE_ID } }),
        next(),
      ),
    );

    expect(await recorded()).toMatchObject({
      action: 'products.delete',
      entityType: 'products',
      entityId: SALE_ID,
      businessId: null,
      userId: null,
      metadata: { sensitive: true, outcome: 'success', status: 200, method: 'DELETE' },
    });
  });

  it('keeps the reason of a void and never the password beside it', async () => {
    const { interceptor, context, next, recorded } = harness();
    await lastValueFrom(
      interceptor.intercept(
        context({
          method: 'POST',
          path: `/sales/${SALE_ID}/void`,
          params: { id: SALE_ID },
          body: { void_reason: 'cliente se fue', password: 'hunter2', pin: '1234' },
        }),
        next(),
      ),
    );

    const entry = await recorded();
    expect(entry.action).toBe('sales.void');
    expect(entry.newValues).toEqual({ void_reason: 'cliente se fue' });
    expect(JSON.stringify(entry)).not.toContain('hunter2');
    expect(JSON.stringify(entry)).not.toContain('"1234"');
  });

  it('never reads a login body', async () => {
    const { interceptor, context, next, recorded } = harness();
    await lastValueFrom(
      interceptor.intercept(
        context({
          method: 'POST',
          path: '/auth/login',
          body: { email: 'ana@example.com', password: 'hunter2' },
        }),
        next(),
      ),
    );

    const entry = await recorded();
    expect(entry.action).toBe('auth.login');
    expect(entry.newValues).toBeNull();
    expect(JSON.stringify(entry)).not.toContain('hunter2');
  });

  it('uses the decorator when the path does not name the operation', async () => {
    const { interceptor, context, next, recorded } = harness(
      DecoratedController.prototype.cancel,
      DecoratedController,
    );
    await lastValueFrom(
      interceptor.intercept(
        context({ method: 'POST', path: `/sales/${SALE_ID}/cancel`, params: { id: SALE_ID } }),
        next(),
      ),
    );

    expect(await recorded()).toMatchObject({ action: 'sales.void', entityType: 'sales' });
  });

  it('attributes the entry to the authenticated principal', async () => {
    const { interceptor, context, next, recorded } = harness();
    await lastValueFrom(
      interceptor.intercept(
        context({
          method: 'DELETE',
          path: `/products/${SALE_ID}`,
          params: { id: SALE_ID },
          user: { userId: 'user-1', businessId: 'biz-1', appRole: 'admin' },
          requestId: 'req-1',
          ip: '203.0.113.9',
          headers: { 'user-agent': 'vitest' },
        }),
        next(),
      ),
    );

    expect(await recorded()).toMatchObject({
      userId: 'user-1',
      businessId: 'biz-1',
      metadata: { request_id: 'req-1', ip: '203.0.113.9', user_agent: 'vitest' },
    });
  });

  it('records a refused sensitive request and still propagates the error', async () => {
    const { interceptor, context, next, recorded } = harness();
    const failed = throwError(() => new HttpException('forbidden', 403));

    await expect(
      lastValueFrom(
        interceptor.intercept(
          context({ method: 'POST', path: '/stock-adjustments', body: { reason: 'x' } }),
          next(failed),
        ),
      ),
    ).rejects.toThrow('forbidden');

    expect(await recorded()).toMatchObject({
      action: 'stock.adjust',
      metadata: { outcome: 'denied', status: 403 },
    });
  });

  it('does not fail the request when the audit write fails', async () => {
    const { interceptor, write, log, context, next } = harness();
    write.mockRejectedValue(new Error('database down'));

    await expect(
      lastValueFrom(
        interceptor.intercept(
          context({ method: 'DELETE', path: `/products/${SALE_ID}`, params: { id: SALE_ID } }),
          next(),
        ),
      ),
    ).resolves.toEqual({ ok: true });

    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        'error',
        'audit_write_failed',
        expect.objectContaining({ entry: expect.objectContaining({ action: 'products.delete' }) }),
      ),
    );
  });
});
