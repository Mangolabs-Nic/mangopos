import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { parsePage } from '../common/input.js';
import { requestContext, type AuthenticatedRequest } from '../common/request-context.js';
import { Roles } from '../roles/roles.decorator.js';
import { SalesService } from './sales.service.js';
import type { CreateSaleInput } from './sales.types.js';

interface PageQuery {
  limit?: unknown;
  offset?: unknown;
}

interface VoidBody {
  reason?: unknown;
}

/**
 * Sales for the current tenant.
 *
 * Reads and creating a ticket are open to every member, including a cashier;
 * voiding is `can_manage()` in the database, so the guard mirrors it rather
 * than letting RLS turn a cashier's void into a silent no-op.
 */
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: PageQuery): Promise<unknown[]> {
    const { token } = requestContext(request);
    return this.sales.list(token, parsePage(query.limit, query.offset));
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<unknown> {
    const { token } = requestContext(request);
    return this.sales.get(token, id);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateSaleInput,
  ): Promise<unknown> {
    const { token, user } = requestContext(request);
    return this.sales.create(token, user, body ?? {});
  }

  @Post(':id/void')
  @Roles('supervisor', 'admin')
  @HttpCode(200)
  void(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: VoidBody,
  ): Promise<unknown> {
    const { token } = requestContext(request);
    return this.sales.void(token, id, body?.reason);
  }
}
