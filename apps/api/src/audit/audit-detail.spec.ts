import { describe, expect, it } from 'vitest';
import { auditDetail } from './audit-detail.js';

describe('auditDetail', () => {
  it('keeps allowlisted scalar columns', () => {
    expect(
      auditDetail({ product_id: 'p1', adjustment: -2, reason: 'merma', total: 12.5, active: true }),
    ).toEqual({ product_id: 'p1', adjustment: -2, reason: 'merma', total: 12.5, active: true });
  });

  it('never records a credential, even when it is in the body', () => {
    const detail = auditDetail({
      reason: 'cliente se fue',
      password: 'hunter2',
      pin: '1234',
      token: 'abc.def.ghi',
      access_token: 'zzz',
      authorization: 'Bearer zzz',
      email: 'ana@example.com',
      contraseña: 'secreta',
    });

    expect(detail).toEqual({ reason: 'cliente se fue' });
  });

  it('drops nested objects and arrays', () => {
    expect(auditDetail({ reason: 'ok', payload: { token: 'x' }, lines: [1, 2] })).toEqual({
      reason: 'ok',
    });
  });

  it('masks a secret written inside free text', () => {
    expect(auditDetail({ void_reason: 'cliente olvidó pin=1234' })).toEqual({
      void_reason: 'cliente olvidó pin=***',
    });
  });

  it('returns null when there is nothing safe to record', () => {
    expect(auditDetail({ password: 'x' })).toBeNull();
    expect(auditDetail({})).toBeNull();
    expect(auditDetail(null)).toBeNull();
    expect(auditDetail('a string')).toBeNull();
    expect(auditDetail([1, 2])).toBeNull();
  });
});
