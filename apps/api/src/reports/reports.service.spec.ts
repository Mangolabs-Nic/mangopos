import { BadGatewayException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppLogger } from '../common/app-logger.js';
import { SupabaseAuthClient, SupabaseAuthError } from '../auth/supabase-auth.client.js';
import { ReportsService } from './reports.service.js';

const TOKEN = 'access-token';
const BUSINESS = '11111111-1111-1111-1111-111111111111';

describe('ReportsService', () => {
  let rpcAs: ReturnType<typeof vi.fn>;
  let logger: { write: ReturnType<typeof vi.fn> };
  let service: ReportsService;

  beforeEach(() => {
    rpcAs = vi.fn();
    logger = { write: vi.fn() };
    const client = { rpcAs } as unknown as SupabaseAuthClient;
    service = new ReportsService(client, logger as unknown as AppLogger);
  });

  it('queries the sales summary with the caller token and local dates', async () => {
    rpcAs.mockResolvedValue([{ bucket: '2026-11-01', total: 100 }]);

    const rows = await service.sales(TOKEN, BUSINESS, { from: '2026-11-01', to: '2026-11-07' }, 'week');

    expect(rows).toEqual([{ bucket: '2026-11-01', total: 100 }]);
    expect(rpcAs).toHaveBeenCalledWith(TOKEN, 'report_sales_summary', {
      p_business_id: BUSINESS,
      p_from: '2026-11-01',
      p_to: '2026-11-07',
      p_granularity: 'week',
    });
  });

  it('reads the single inventory row, or null when RLS hides the tenant', async () => {
    rpcAs.mockResolvedValueOnce([{ product_count: 3 }]);
    await expect(service.inventory(TOKEN, BUSINESS)).resolves.toEqual({ product_count: 3 });

    rpcAs.mockResolvedValueOnce([]);
    await expect(service.inventory(TOKEN, BUSINESS)).resolves.toBeNull();
  });

  it('queries the expense breakdown for the range', async () => {
    rpcAs.mockResolvedValue([]);

    await service.expenses(TOKEN, BUSINESS, { from: '2026-11-01', to: '2026-11-07' });

    expect(rpcAs).toHaveBeenCalledWith(TOKEN, 'report_expense_breakdown', {
      p_business_id: BUSINESS,
      p_from: '2026-11-01',
      p_to: '2026-11-07',
    });
  });

  it('reads the single profit row', async () => {
    rpcAs.mockResolvedValue([{ net_profit: 50 }]);
    await expect(service.profit(TOKEN, BUSINESS, { from: '2026-11-01', to: '2026-11-07' })).resolves.toEqual({
      net_profit: 50,
    });
  });

  it('maps an upstream failure to a gateway error without leaking it', async () => {
    rpcAs.mockRejectedValue(new SupabaseAuthError(500, 'internal query detail'));

    await expect(
      service.sales(TOKEN, BUSINESS, { from: '2026-11-01', to: '2026-11-07' }, 'day'),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(logger.write).toHaveBeenCalledWith('error', 'report_query_failed', {
      report: 'report_sales_summary',
      status: 500,
    });
  });
});
