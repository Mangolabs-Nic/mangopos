import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { SupabaseAuthClient } from '../auth/supabase-auth.client.js';
import {
  money,
  optionalUuid,
  requireText,
  requireUuid,
  toCents,
  toInteger,
  type Page,
} from '../common/input.js';
import { restError } from '../common/rest-error.js';
import type { CreateSaleInput, SaleItemInput } from './sales.types.js';

const MAX_ITEMS = 200;

function parseItems(value: unknown): SaleItemInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException('items must be a non-empty array');
  }
  if (value.length > MAX_ITEMS) throw new BadRequestException('too many items');

  return value.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    return {
      product_id: requireUuid(item.product_id, `items[${index}].product_id`),
      quantity: toInteger(item.quantity, `items[${index}].quantity`, 1, 100_000),
    };
  });
}

/**
 * Sales over PostgREST with the caller's token.
 *
 * The API computes the money and the database enforces the rest: `sale_items`
 * triggers deduct stock, snapshot the cost, derive the line's tenant, and the
 * `sales` guards allow a void and nothing else. A client therefore never sends
 * a price, a total or a business id it could forge; it sends products and
 * quantities, and the catalogue price is read from the tenant's own rows.
 */
@Injectable()
export class SalesService {
  constructor(private readonly client: SupabaseAuthClient) {}

  async list(token: string, page: Page): Promise<unknown[]> {
    const query = new URLSearchParams({
      select: '*,sale_items(*)',
      order: 'created_at.desc',
      limit: String(page.limit),
      offset: String(page.offset),
    });
    return this.run(
      () => this.client.restAs<unknown[]>(token, 'GET', `/sales?${query.toString()}`),
      'the sales could not be listed',
    );
  }

  async get(token: string, id: string): Promise<unknown> {
    const saleId = requireUuid(id, 'id');
    const query = new URLSearchParams({ select: '*,sale_items(*)', id: `eq.${saleId}` });
    const rows = await this.run(
      () => this.client.restAs<unknown[]>(token, 'GET', `/sales?${query.toString()}`),
      'the sale could not be read',
    );
    if (rows.length === 0) throw new NotFoundException('sale not found');
    return rows[0];
  }

  /**
   * One call into `create_sale`, because a sale and its lines must commit or
   * fail together. The function prices every line from the catalogue and lets
   * the item triggers deduct stock, so nothing the client sent can become a
   * price, a total or another tenant's product.
   */
  async create(token: string, user: AuthenticatedUser, input: CreateSaleInput): Promise<unknown> {
    const items = parseItems(input.items);
    const taxCents = input.tax === undefined ? 0 : toCents(input.tax, 'tax');
    const paymentMethodId = optionalUuid(input.payment_method_id, 'payment_method_id');

    return this.run(
      () =>
        this.client.rpcAs<unknown>(token, 'create_sale', {
          p_business_id: user.businessId,
          p_user_id: user.userId,
          p_items: items,
          p_tax: money(taxCents),
          p_payment_method_id: paymentMethodId,
        }),
      'the sale could not be recorded',
    );
  }

  async void(token: string, id: string, reason: unknown): Promise<unknown> {
    const saleId = requireUuid(id, 'id');
    const text = requireText(reason, 'reason', 500);

    const query = new URLSearchParams({
      id: `eq.${saleId}`,
      status: 'eq.completed',
      select: '*',
    });
    const rows = await this.run(
      () =>
        this.client.restAs<unknown[]>(
          token,
          'PATCH',
          `/sales?${query.toString()}`,
          { status: 'voided', void_reason: text },
          'return=representation',
        ),
      'the sale could not be voided',
    );
    if (rows.length > 0) return rows[0];

    const existing = await this.run(
      () =>
        this.client.restAs<Array<{ id: string; status: string }>>(
          token,
          'GET',
          `/sales?${new URLSearchParams({ select: 'id,status', id: `eq.${saleId}` }).toString()}`,
        ),
      'the sale could not be read',
    );
    if (existing.length === 0) throw new NotFoundException('sale not found');
    throw new ConflictException('the sale is already voided');
  }

  private async run<T>(request: () => Promise<T>, fallback: string): Promise<T> {
    try {
      return await request();
    } catch (error) {
      return restError(error, fallback);
    }
  }
}
