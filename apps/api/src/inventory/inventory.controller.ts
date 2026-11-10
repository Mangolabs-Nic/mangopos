import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Audit } from '../audit/audit.decorator.js';
import { parsePage } from '../common/input.js';
import { requestContext, type AuthenticatedRequest } from '../common/request-context.js';
import { Roles } from '../roles/roles.decorator.js';
import { InventoryService } from './inventory.service.js';

interface PageQuery {
  limit?: unknown;
  offset?: unknown;
  active?: unknown;
}

/**
 * Catalogue and stock. The database must accept and reject the same writes:
 * `products` is `can_manage()` for insert/update and admin-only for delete, and
 * a product with sales history cannot be deleted even by an admin.
 */
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: PageQuery): Promise<unknown[]> {
    const { token } = requestContext(request);
    return this.inventory.list(token, parsePage(query.limit, query.offset), query.active);
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<unknown> {
    const { token } = requestContext(request);
    return this.inventory.get(token, id);
  }

  @Post()
  @Roles('supervisor', 'admin')
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const { token, user } = requestContext(request);
    return this.inventory.create(token, user, body ?? {});
  }

  @Put(':id')
  @Roles('supervisor', 'admin')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const { token } = requestContext(request);
    return this.inventory.update(token, id, body ?? {});
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(200)
  remove(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<{ deleted: true }> {
    const { token } = requestContext(request);
    return this.inventory.remove(token, id);
  }

  /**
   * The route name does not match the interceptor's stock pattern, so the action
   * is declared here. The database also appends `stock.adjust`; the API entry
   * records the request, the trigger records the movement.
   */
  @Post('adjust')
  @Roles('supervisor', 'admin')
  @Audit({ action: 'stock.adjust', entity: 'stock_adjustments', sensitive: true })
  adjust(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const { token, user } = requestContext(request);
    return this.inventory.adjust(token, user, body ?? {});
  }
}
