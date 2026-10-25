import { describe, expect, it } from 'vitest';
import {
  decideAudit,
  entityIdFromParams,
  entityTypeFromPath,
} from './audit-policy.js';

describe('decideAudit', () => {
  it('leaves reads alone', () => {
    expect(decideAudit('GET', '/sales')).toBeNull();
    expect(decideAudit('GET', '/audit')).toBeNull();
  });

  it('leaves routine writes to the trigger', () => {
    // The AFTER trigger records the row with its real before and after values;
    // a second entry for the same change would be noise.
    expect(decideAudit('POST', '/products')).toBeNull();
    expect(decideAudit('PATCH', '/sales/123')).toBeNull();
  });

  it('records every delete as sensitive', () => {
    expect(decideAudit('DELETE', '/products/123')).toEqual({
      action: 'products.delete',
      entityType: 'products',
      sensitive: true,
    });
  });

  it('names a void and marks it sensitive', () => {
    expect(decideAudit('POST', '/sales/123/void')).toEqual({
      action: 'sales.void',
      entityType: 'sales',
      sensitive: true,
    });
  });

  it('names a stock adjustment and marks it sensitive', () => {
    expect(decideAudit('POST', '/stock-adjustments')).toEqual({
      action: 'stock.adjust',
      entityType: 'stock_adjustments',
      sensitive: true,
    });
    expect(decideAudit('POST', '/stock/adjust')?.action).toBe('stock.adjust');
  });

  it('records the events no trigger can see', () => {
    expect(decideAudit('POST', '/auth/login')).toEqual({
      action: 'auth.login',
      entityType: 'session',
      sensitive: false,
    });
    expect(decideAudit('POST', '/auth/logout')?.action).toBe('auth.logout');
    expect(decideAudit('POST', '/backups')).toEqual({
      action: 'backup.create',
      entityType: 'backup',
      sensitive: true,
    });
  });

  it('lets a decorator name the operation precisely', () => {
    expect(
      decideAudit('POST', '/sales/123/cancel', {
        action: 'sales.void',
        entity: 'sales',
        sensitive: true,
      }),
    ).toEqual({ action: 'sales.void', entityType: 'sales', sensitive: true });
  });

  it('does not let a decorator lower sensitivity for a delete', () => {
    expect(
      decideAudit('DELETE', '/products/123', {
        action: 'products.archive',
        entity: 'products',
        sensitive: false,
      })?.sensitive,
    ).toBe(true);
  });

  it('ignores a query string when matching', () => {
    expect(decideAudit('POST', '/sales/123/void?notify=true')?.action).toBe('sales.void');
  });
});

describe('entityTypeFromPath', () => {
  it('uses the first meaningful segment', () => {
    expect(entityTypeFromPath('/sales/123/void')).toBe('sales');
    expect(entityTypeFromPath('/stock-adjustments')).toBe('stock_adjustments');
    expect(entityTypeFromPath('/api/v1/products/9')).toBe('products');
    expect(entityTypeFromPath('/')).toBe('request');
  });
});

describe('entityIdFromParams', () => {
  const id = '3f0c9b6e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

  it('accepts a uuid under any of the id keys', () => {
    expect(entityIdFromParams({ id })).toBe(id);
    expect(entityIdFromParams({ saleId: id })).toBe(id);
    expect(entityIdFromParams({ productId: id })).toBe(id);
  });

  it('drops anything that is not a uuid, so the insert cannot fail on a cast', () => {
    expect(entityIdFromParams({ id: 'me' })).toBeNull();
    expect(entityIdFromParams({ id: '123' })).toBeNull();
    expect(entityIdFromParams({})).toBeNull();
    expect(entityIdFromParams(undefined)).toBeNull();
  });
});
