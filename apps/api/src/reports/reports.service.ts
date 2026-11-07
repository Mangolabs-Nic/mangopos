import { BadGatewayException, Injectable } from '@nestjs/common';
import { AppLogger } from '../common/app-logger.js';
import { SupabaseAuthClient, SupabaseAuthError } from '../auth/supabase-auth.client.js';
import type { Granularity, ReportRange } from './report-range.js';
import type {
  ExpenseBreakdownRow,
  InventoryValuationRow,
  ProfitRow,
  SalesSummaryRow,
} from './reports.types.js';

/**
 * Read-only reporting over the aggregate functions in migration 013.
 *
 * Every call travels with the caller's JWT rather than the service key: the
 * functions are SECURITY INVOKER, so RLS decides which rows a role may see. The
 * API still passes its verified `business_id`, which keeps the query specific and
 * gives a cheap second check if a function is ever called from somewhere else.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly client: SupabaseAuthClient,
    private readonly logger: AppLogger,
  ) {}

  sales(
    token: string,
    businessId: string,
    range: ReportRange,
    granularity: Granularity,
  ): Promise<SalesSummaryRow[]> {
    return this.run<SalesSummaryRow[]>(token, 'report_sales_summary', {
      p_business_id: businessId,
      p_from: range.from,
      p_to: range.to,
      p_granularity: granularity,
    });
  }

  async inventory(token: string, businessId: string): Promise<InventoryValuationRow | null> {
    const rows = await this.run<InventoryValuationRow[]>(
      token,
      'report_inventory_valuation',
      { p_business_id: businessId },
    );
    return rows[0] ?? null;
  }

  expenses(
    token: string,
    businessId: string,
    range: ReportRange,
  ): Promise<ExpenseBreakdownRow[]> {
    return this.run<ExpenseBreakdownRow[]>(token, 'report_expense_breakdown', {
      p_business_id: businessId,
      p_from: range.from,
      p_to: range.to,
    });
  }

  async profit(token: string, businessId: string, range: ReportRange): Promise<ProfitRow | null> {
    const rows = await this.run<ProfitRow[]>(token, 'report_profit', {
      p_business_id: businessId,
      p_from: range.from,
      p_to: range.to,
    });
    return rows[0] ?? null;
  }

  private async run<T>(
    token: string,
    report: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await this.client.rpcAs<T>(token, report, args);
    } catch (error) {
      // The upstream body is not surfaced: it can quote the query. The status is
      // enough to tell an auth problem from a database failure in the log.
      this.logger.write('error', 'report_query_failed', {
        report,
        status: error instanceof SupabaseAuthError ? error.status : null,
      });
      throw new BadGatewayException('the report could not be generated');
    }
  }
}
