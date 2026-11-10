import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseAuthError } from '../auth/supabase-auth.client.js';

/**
 * Turns a PostgREST failure into an answer the POS can act on.
 *
 * The database is the rulebook: the stock, void, tenant and delete guards all
 * live in triggers, so their constraint names are the closest thing to a real
 * reason this layer gets. Anything unrecognised becomes a generic upstream
 * failure rather than leaking a query or a schema detail.
 */
export function restError(error: unknown, fallback: string): never {
  if (!(error instanceof SupabaseAuthError)) throw new BadGatewayException(fallback);

  // PostgREST puts the SQLSTATE in `code` and the readable text in the message,
  // so match against both.
  const detail = `${error.code} ${error.detail}`.toLowerCase();
  if (detail.includes('not enough stock')) {
    throw new ConflictException('not enough stock for this sale');
  }
  if (detail.includes('products_stock_check')) {
    throw new ConflictException('not enough stock for this sale');
  }
  if (detail.includes('unknown product')) {
    throw new BadRequestException('unknown product');
  }
  if (detail.includes('is not available')) {
    throw new BadRequestException('the product is not available');
  }
  if (detail.includes('must be attributed to the caller')) {
    throw new ForbiddenException('forbidden');
  }
  if (detail.includes('has no stock to adjust')) {
    throw new BadRequestException('a service has no stock to adjust');
  }
  if (detail.includes('sales are voided')) {
    throw new ConflictException('sales are voided, never deleted');
  }
  if (detail.includes('already voided') || detail.includes('voided and can no longer')) {
    throw new ConflictException('the sale is already voided');
  }
  if (detail.includes('void_requires_reason')) {
    throw new BadRequestException('a void needs a reason');
  }
  if (detail.includes('history')) {
    throw new ConflictException(
      'the product has sales history; deactivate it instead of deleting it',
    );
  }
  if (detail.includes('duplicate key')) {
    throw new ConflictException('a record with that value already exists');
  }

  switch (error.status) {
    case 400:
      throw new BadRequestException('invalid request');
    case 401:
    case 403:
      throw new ForbiddenException('forbidden');
    case 404:
      throw new NotFoundException('not found');
    case 409:
      throw new ConflictException('conflict');
    default:
      throw new BadGatewayException(fallback);
  }
}
