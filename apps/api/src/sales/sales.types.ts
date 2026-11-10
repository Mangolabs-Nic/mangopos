export interface SaleItemInput {
  product_id: string;
  quantity: number;
}

export interface CreateSaleInput {
  items?: unknown;
  tax?: unknown;
  payment_method_id?: unknown;
}
