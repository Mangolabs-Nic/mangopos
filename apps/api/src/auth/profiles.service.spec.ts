import { UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The query spy stands in for a real pg client; the mocked Pool just forwards.
const query = vi.hoisted(() => vi.fn());

vi.mock('pg', () => ({
  default: {
    Pool: class {
      query(...args: unknown[]) {
        return query(...args);
      }
    },
  },
}));

import { ProfilesService } from './profiles.service.js';

const rows = (result: Array<{ role: string; business_id: string; active: boolean }>) => ({
  rows: result,
});

describe('ProfilesService', () => {
  const service = new ProfilesService();

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    query.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the app role and business id for an active member', async () => {
    query.mockResolvedValue(rows([{ role: 'supervisor', business_id: 'biz-1', active: true }]));

    await expect(service.resolve('user-1')).resolves.toEqual({
      appRole: 'supervisor',
      businessId: 'biz-1',
    });

    // Query is parameterised, never string-interpolated.
    const [text, params] = query.mock.calls[0] as [string, string[]];
    expect(text).toContain('FROM public.profiles');
    expect(text).toContain('$1');
    expect(params).toEqual(['user-1']);
  });

  it('rejects when the user has no profile row', async () => {
    query.mockResolvedValue(rows([]));
    await expect(service.resolve('ghost')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a deactivated profile', async () => {
    query.mockResolvedValue(rows([{ role: 'cashier', business_id: 'biz-1', active: false }]));
    await expect(service.resolve('user-1')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a role that is not one of the database roles', async () => {
    query.mockResolvedValue(rows([{ role: 'owner', business_id: 'biz-1', active: true }]));
    await expect(service.resolve('user-1')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
