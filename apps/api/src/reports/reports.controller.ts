import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { bearerToken, type RequestWithAuthHeader } from '../auth/bearer.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { Roles } from '../roles/roles.decorator.js';
import { toCsv, toPdf, type Column } from './report-format.js';
import {
  parseFormat,
  parseGranularity,
  parseRange,
  type ExportFormat,
} from './report-range.js';
import { ReportsService } from './reports.service.js';
import type {
  ExpenseBreakdownRow,
  InventoryValuationRow,
  ProfitRow,
  SalesSummaryRow,
} from './reports.types.js';

interface ReportRequest extends RequestWithAuthHeader {
  user?: AuthenticatedUser;
}

interface ReportQueryParams {
  from?: unknown;
  to?: unknown;
  granularity?: unknown;
  format?: unknown;
}

const SALES_COLUMNS: readonly Column<SalesSummaryRow>[] = [
  { key: 'bucket', label: 'Fecha' },
  { key: 'sale_count', label: 'Ventas' },
  { key: 'voided_count', label: 'Anuladas' },
  { key: 'subtotal', label: 'Subtotal' },
  { key: 'tax', label: 'Impuesto' },
  { key: 'total', label: 'Total' },
];

const INVENTORY_COLUMNS: readonly Column<InventoryValuationRow>[] = [
  { key: 'product_count', label: 'Productos' },
  { key: 'service_count', label: 'Servicios' },
  { key: 'unit_count', label: 'Unidades' },
  { key: 'cost_value', label: 'Valor al costo' },
  { key: 'retail_value', label: 'Valor de venta' },
  { key: 'low_stock_count', label: 'Stock bajo' },
];

const EXPENSE_COLUMNS: readonly Column<ExpenseBreakdownRow>[] = [
  { key: 'category', label: 'Categoría' },
  { key: 'entry_count', label: 'Registros' },
  { key: 'total', label: 'Total' },
];

const PROFIT_COLUMNS: readonly Column<ProfitRow>[] = [
  { key: 'sale_count', label: 'Ventas' },
  { key: 'revenue', label: 'Ingresos' },
  { key: 'tax', label: 'Impuesto' },
  { key: 'cogs', label: 'Costo de ventas' },
  { key: 'gross_profit', label: 'Utilidad bruta' },
  { key: 'expenses', label: 'Gastos' },
  { key: 'net_profit', label: 'Utilidad neta' },
];

/** The verified bearer token and tenant the reports query with. */
function context(request: ReportRequest): { token: string; businessId: string } {
  const token = bearerToken(request);
  const businessId = request.user?.businessId;
  if (!token || !businessId) throw new UnauthorizedException('authentication required');
  return { token, businessId };
}

/**
 * Read-only reports for the current tenant.
 *
 * The global `JwtAuthGuard` has already verified the token and `RolesGuard`
 * enforces `@Roles`; the token is forwarded to PostgREST so RLS applies inside
 * the functions. Reads are never written to the audit trail, per the plan.
 */
@Controller('reports')
@Roles('admin', 'supervisor')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  sales(
    @Req() request: ReportRequest,
    @Query() query: ReportQueryParams,
  ): Promise<SalesSummaryRow[]> {
    const { token, businessId } = context(request);
    return this.reports.sales(
      token,
      businessId,
      parseRange(query.from, query.to),
      parseGranularity(query.granularity),
    );
  }

  @Get('inventory')
  inventory(
    @Req() request: ReportRequest,
  ): Promise<InventoryValuationRow | null> {
    const { token, businessId } = context(request);
    return this.reports.inventory(token, businessId);
  }

  @Get('expenses')
  expenses(
    @Req() request: ReportRequest,
    @Query() query: ReportQueryParams,
  ): Promise<ExpenseBreakdownRow[]> {
    const { token, businessId } = context(request);
    return this.reports.expenses(token, businessId, parseRange(query.from, query.to));
  }

  @Get('profit')
  profit(
    @Req() request: ReportRequest,
    @Query() query: ReportQueryParams,
  ): Promise<ProfitRow | null> {
    const { token, businessId } = context(request);
    return this.reports.profit(token, businessId, parseRange(query.from, query.to));
  }

  @Get('sales/export')
  async exportSales(
    @Req() request: ReportRequest,
    @Query() query: ReportQueryParams,
    @Res() response: Response,
  ): Promise<void> {
    const { token, businessId } = context(request);
    const range = parseRange(query.from, query.to);
    const rows = await this.reports.sales(
      token,
      businessId,
      range,
      parseGranularity(query.granularity),
    );
    await this.deliver(
      response,
      'sales',
      `Reporte de ventas ${range.from} a ${range.to}`,
      SALES_COLUMNS,
      rows,
      parseFormat(query.format),
      `${range.from}_${range.to}`,
    );
  }

  @Get('inventory/export')
  async exportInventory(
    @Req() request: ReportRequest,
    @Query() query: ReportQueryParams,
    @Res() response: Response,
  ): Promise<void> {
    const { token, businessId } = context(request);
    const row = await this.reports.inventory(token, businessId);
    await this.deliver(
      response,
      'inventario',
      'Valoración de inventario',
      INVENTORY_COLUMNS,
      row ? [row] : [],
      parseFormat(query.format),
      new Date().toISOString().slice(0, 10),
    );
  }

  @Get('expenses/export')
  async exportExpenses(
    @Req() request: ReportRequest,
    @Query() query: ReportQueryParams,
    @Res() response: Response,
  ): Promise<void> {
    const { token, businessId } = context(request);
    const range = parseRange(query.from, query.to);
    const rows = await this.reports.expenses(token, businessId, range);
    await this.deliver(
      response,
      'gastos',
      `Gastos ${range.from} a ${range.to}`,
      EXPENSE_COLUMNS,
      rows,
      parseFormat(query.format),
      `${range.from}_${range.to}`,
    );
  }

  @Get('profit/export')
  async exportProfit(
    @Req() request: ReportRequest,
    @Query() query: ReportQueryParams,
    @Res() response: Response,
  ): Promise<void> {
    const { token, businessId } = context(request);
    const range = parseRange(query.from, query.to);
    const row = await this.reports.profit(token, businessId, range);
    await this.deliver(
      response,
      'utilidad',
      `Utilidad ${range.from} a ${range.to}`,
      PROFIT_COLUMNS,
      row ? [row] : [],
      parseFormat(query.format),
      `${range.from}_${range.to}`,
    );
  }

  private async deliver<T extends object>(
    response: Response,
    name: string,
    title: string,
    columns: readonly Column<T>[],
    rows: readonly T[],
    format: ExportFormat,
    stamp: string,
  ): Promise<void> {
    if (format === 'pdf') {
      response.setHeader('content-type', 'application/pdf');
      response.setHeader('content-disposition', `attachment; filename="${name}-${stamp}.pdf"`);
      response.send(await toPdf(title, columns, rows));
      return;
    }

    response.setHeader('content-type', 'text/csv; charset=utf-8');
    response.setHeader('content-disposition', `attachment; filename="${name}-${stamp}.csv"`);
    response.send(toCsv(columns, rows));
  }
}
