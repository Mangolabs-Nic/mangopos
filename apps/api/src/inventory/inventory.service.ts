import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { SupabaseAuthClient } from '../auth/supabase-auth.client.js';
import {
  money,
  optionalText,
  optionalUuid,
  requireText,
  requireUuid,
  toCents,
  toInteger,
  type Page,
} from '../common/input.js';
import { restError } from '../common/rest-error.js';

const MAX_STOCK = 1_000_000;

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException(`${field} must be true or false`);
  return value;
}

/**
 * Catalogue and stock for the current tenant.
 *
 * `stock` is deliberately not writable here: every change goes through
 * `POST /inventory/adjust`, which inserts a `stock_adjustments` row and lets the
 * database move the counter and record who did it. A direct update would leave
 * the ledger claiming a different number than the shelf.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly client: SupabaseAuthClient) {}

  async list(token: string, page: Page, active: unknown): Promise<unknown[]> {
    const query = new URLSearchParams({
      select: '*',
      order: 'name.asc',
      limit: String(page.limit),
      offset: String(page.offset),
    });
    if (active === 'true' || active === 'false') query.set('active', `eq.${active}`);

    return this.run(
      () => this.client.restAs<unknown[]>(token, 'GET', `/products?${query.toString()}`),
      'the catalogue could not be listed',
    );
  }

  async get(token: string, id: string): Promise<unknown> {
    const productId = requireUuid(id, 'id');
    const rows = await this.run(
      () =>
        this.client.restAs<unknown[]>(
          token,
          'GET',
          `/products?${new URLSearchParams({ select: '*', id: `eq.${productId}` }).toString()}`,
        ),
      'the product could not be read',
    );
    if (rows.length === 0) throw new NotFoundException('product not found');
    return rows[0];
  }

  async create(token: string, user: AuthenticatedUser, input: Record<string, unknown>): Promise<unknown> {
    const body = {
      business_id: user.businessId,
      name: requireText(input.name, 'name', 120),
      price: money(input.price === undefined ? 0 : toCents(input.price, 'price')),
      cost: money(input.cost === undefined ? 0 : toCents(input.cost, 'cost')),
      stock: input.stock === undefined ? 0 : toInteger(input.stock, 'stock', 0, MAX_STOCK),
      low_stock_threshold:
        input.low_stock_threshold === undefined
          ? 5
          : toInteger(input.low_stock_threshold, 'low_stock_threshold', 0, MAX_STOCK),
      is_service: input.is_service === undefined ? false : boolean(input.is_service, 'is_service'),
      sku: optionalText(input.sku, 'sku', 64),
      barcode: optionalText(input.barcode, 'barcode', 64),
      category_id: optionalUuid(input.category_id, 'category_id'),
    };

    const rows = await this.run(
      () =>
        this.client.restAs<unknown[]>(
          token,
          'POST',
          '/products?select=*',
          body,
          'return=representation',
        ),
      'the product could not be created',
    );
    return rows[0];
  }

  async update(token: string, id: string, input: Record<string, unknown>): Promise<unknown> {
    const productId = requireUuid(id, 'id');
    if ('stock' in input) {
      throw new BadRequestException('stock changes go through POST /inventory/adjust');
    }

    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body.name = requireText(input.name, 'name', 120);
    if (input.price !== undefined) body.price = money(toCents(input.price, 'price'));
    if (input.cost !== undefined) body.cost = money(toCents(input.cost, 'cost'));
    if (input.sku !== undefined) body.sku = optionalText(input.sku, 'sku', 64);
    if (input.barcode !== undefined) body.barcode = optionalText(input.barcode, 'barcode', 64);
    if (input.category_id !== undefined) {
      body.category_id = optionalUuid(input.category_id, 'category_id');
    }
    if (input.low_stock_threshold !== undefined) {
      body.low_stock_threshold = toInteger(
        input.low_stock_threshold,
        'low_stock_threshold',
        0,
        MAX_STOCK,
      );
    }
    if (input.is_service !== undefined) {
      body.is_service = boolean(input.is_service, 'is_service');
    }
    if (input.active !== undefined) body.active = boolean(input.active, 'active');
    if (Object.keys(body).length === 0) throw new BadRequestException('nothing to update');

    const rows = await this.run(
      () =>
        this.client.restAs<unknown[]>(
          token,
          'PATCH',
          `/products?id=eq.${productId}&select=*`,
          body,
          'return=representation',
        ),
      'the product could not be updated',
    );
    if (rows.length === 0) throw new NotFoundException('product not found');
    return rows[0];
  }

  async remove(token: string, id: string): Promise<{ deleted: true }> {
    const productId = requireUuid(id, 'id');
    const rows = await this.run(
      () =>
        this.client.restAs<unknown[]>(
          token,
          'DELETE',
          `/products?id=eq.${productId}&select=id`,
          undefined,
          'return=representation',
        ),
      'the product could not be deleted',
    );
    if (rows.length === 0) throw new NotFoundException('product not found');
    return { deleted: true };
  }

  async adjust(token: string, user: AuthenticatedUser, input: Record<string, unknown>): Promise<unknown> {
    const productId = requireUuid(input.product_id, 'product_id');
    const adjustment = toInteger(input.adjustment, 'adjustment', -MAX_STOCK, MAX_STOCK);
    if (adjustment === 0) throw new BadRequestException('adjustment must not be zero');
    const reason = requireText(input.reason, 'reason', 200);

    // The insert *is* the movement: `stock_adjustments_normalise` fills
    // quantity_before/after and `apply_stock_adjustment` moves products.stock.
    const rows = await this.run(
      () =>
        this.client.restAs<unknown[]>(
          token,
          'POST',
          '/stock_adjustments?select=*',
          { product_id: productId, user_id: user.userId, adjustment, reason },
          'return=representation',
        ),
      'the adjustment could not be recorded',
    );
    return rows[0];
  }

  private async run<T>(request: () => Promise<T>, fallback: string): Promise<T> {
    try {
      return await request();
    } catch (error) {
      return restError(error, fallback);
    }
  }
}
