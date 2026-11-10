import { BadRequestException } from '@nestjs/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Body validation for the POS routes. No `class-validator`: the shapes are tiny. */
export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new BadRequestException(`${field} must be a uuid`);
  }
  return value;
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireUuid(value, field);
}

export function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new BadRequestException(`${field} is required`);
  const text = value.trim();
  if (text.length === 0) throw new BadRequestException(`${field} is required`);
  if (text.length > max) throw new BadRequestException(`${field} is too long`);
  return text;
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BadRequestException(`${field} must be text`);
  const text = value.trim();
  if (text.length === 0) return null;
  if (text.length > max) throw new BadRequestException(`${field} is too long`);
  return text;
}

/**
 * A non-negative amount in cents.
 *
 * Money is sent to Postgres as a two-decimal string, so rounding happens once,
 * here, on an integer: `0.1 + 0.2` never reaches the total.
 */
export function toCents(value: unknown, field: string): number {
  const number = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) {
    throw new BadRequestException(`${field} must be a non-negative number`);
  }
  const cents = Math.round(number * 100);
  if (Math.abs(number * 100 - cents) > 1e-6 || cents > 99_999_999_999) {
    throw new BadRequestException(`${field} must have at most two decimals`);
  }
  return cents;
}

export function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function toInteger(value: unknown, field: string, min: number, max: number): number {
  const number = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) {
    throw new BadRequestException(`${field} must be an integer between ${min} and ${max}`);
  }
  return number;
}

export interface Page {
  limit: number;
  offset: number;
}

export function parsePage(limit: unknown, offset: unknown): Page {
  const size =
    limit === undefined || limit === '' ? 100 : toInteger(limit, 'limit', 1, 500);
  const start = offset === undefined || offset === '' ? 0 : toInteger(offset, 'offset', 0, 1_000_000);
  return { limit: size, offset: start };
}
