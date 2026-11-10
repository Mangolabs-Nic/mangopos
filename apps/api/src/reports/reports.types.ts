/** One row of `report_sales_summary`; `bucket` is the local bucket start. */
export interface SalesSummaryRow {
  currency: string;
  bucket: string;
  sale_count: number;
  voided_count: number;
  subtotal: number;
  tax: number;
  total: number;
}

/** One row of `report_inventory_valuation`. */
export interface InventoryValuationRow {
  currency: string;
  product_count: number;
  service_count: number;
  unit_count: number;
  cost_value: number;
  retail_value: number;
  low_stock_count: number;
}

/** One row of `report_expense_breakdown`. */
export interface ExpenseBreakdownRow {
  category: string;
  entry_count: number;
  total: number;
}

/** One row of `report_profit`. */
export interface ProfitRow {
  currency: string;
  sale_count: number;
  revenue: number;
  tax: number;
  cogs: number;
  gross_profit: number;
  expenses: number;
  net_profit: number;
}
