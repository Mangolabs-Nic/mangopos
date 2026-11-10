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
import { parsePage } from '../common/input.js';
import { requestContext, type AuthenticatedRequest } from '../common/request-context.js';
import { Roles } from '../roles/roles.decorator.js';
import { ExpensesService } from './expenses.service.js';

interface PageQuery {
  limit?: unknown;
  offset?: unknown;
}

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @Roles('supervisor', 'admin')
  list(@Req() request: AuthenticatedRequest, @Query() query: PageQuery): Promise<unknown[]> {
    const { token } = requestContext(request);
    return this.expenses.list(token, parsePage(query.limit, query.offset));
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const { token, user } = requestContext(request);
    return this.expenses.create(token, user, body ?? {});
  }

  @Put(':id')
  @Roles('supervisor', 'admin')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const { token } = requestContext(request);
    return this.expenses.update(token, id, body ?? {});
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(200)
  remove(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<{ deleted: true }> {
    const { token } = requestContext(request);
    return this.expenses.remove(token, id);
  }
}
