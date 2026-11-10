import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { SupabaseAuthClient } from '../auth/supabase-auth.client.js';
import { money, optionalText, requireUuid, toCents, type Page } from '../common/input.js';
import { restError } from '../common/rest-error.js';

/**
 * Expenses for the current tenant.
 *
 * A cashier may record one (the money already left the till) but only a
 * supervisor or admin may correct it, which is the same split the RLS policies
 * enforce. Amounts are entered in the business currency and stored as numeric.
 */
@Injectable()
export class ExpensesService {
  constructor(private readonly client: SupabaseAuthClient) {}

  async list(token: string, page: Page): Promise<unknown[]> {
    const query = new URLSearchParams({
      select: '*',
      order: 'created_at.desc',
      limit: String(page.limit),
      offset: String(page.offset),
    });
    return this.run(
      () => this.client.restAs<unknown[]>(token, 'GET', `/expenses?${query.toString()}`),
      'the expenses could not be listed',
    );
  }

  async create(token: string, user: AuthenticatedUser, input: Record<string, unknown>): Promise<unknown> {
    const body = {
      business_id: user.businessId,
      user_id: user.userId,
      amount: money(toCents(input.amount, 'amount')),
      category: optionalText(input.category, 'category', 60),
      description: optionalText(input.description, 'description', 500),
    };

    const rows = await this.run(
      () =>
        this.client.restAs<unknown[]>(
          token,
          'POST',
          '/expenses?select=*',
          body,
          'return=representation',
        ),
      'the expense could not be recorded',
    );
    return rows[0];
  }

  async update(token: string, id: string, input: Record<string, unknown>): Promise<unknown> {
    const expenseId = requireUuid(id, 'id');

    const body: Record<string, unknown> = {};
    if (input.amount !== undefined) body.amount = money(toCents(input.amount, 'amount'));
    if (input.category !== undefined) body.category = optionalText(input.category, 'category', 60);
    if (input.description !== undefined) {
      body.description = optionalText(input.description, 'description', 500);
    }
    if (Object.keys(body).length === 0) throw new BadRequestException('nothing to update');

    const rows = await this.run(
      () =>
        this.client.restAs<unknown[]>(
          token,
          'PATCH',
          `/expenses?id=eq.${expenseId}&select=*`,
          body,
          'return=representation',
        ),
      'the expense could not be updated',
    );
    if (rows.length === 0) throw new NotFoundException('expense not found');
    return rows[0];
  }

  async remove(token: string, id: string): Promise<{ deleted: true }> {
    const expenseId = requireUuid(id, 'id');
    const rows = await this.run(
      () =>
        this.client.restAs<unknown[]>(
          token,
          'DELETE',
          `/expenses?id=eq.${expenseId}&select=id`,
          undefined,
          'return=representation',
        ),
      'the expense could not be deleted',
    );
    if (rows.length === 0) throw new NotFoundException('expense not found');
    return { deleted: true };
  }

  private async run<T>(request: () => Promise<T>, fallback: string): Promise<T> {
    try {
      return await request();
    } catch (error) {
      return restError(error, fallback);
    }
  }
}
