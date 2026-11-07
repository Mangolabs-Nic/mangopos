import { BadRequestException } from '@nestjs/common';

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export type ExportFormat = 'csv' | 'pdf';

/** Inclusive local dates, `YYYY-MM-DD`, interpreted in the business timezone. */
export interface ReportRange {
  from: string;
  to: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  // Rejects 2026-02-30 and friends, which `Date` would otherwise roll over.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validates the date range. Both ends are inclusive and local to the business;
 * the database converts them, because only there is `businesses.timezone` known.
 */
export function parseRange(from: unknown, to: unknown): ReportRange {
  if (!isDate(from) || !isDate(to)) {
    throw new BadRequestException('from and to must be YYYY-MM-DD dates');
  }
  if (from > to) throw new BadRequestException('from must be on or before to');
  return { from, to };
}

/** `day` when omitted, so the shortest report is also the default. */
export function parseGranularity(value: unknown): Granularity {
  if (value === undefined || value === '' || value === null) return 'day';
  if (typeof value !== 'string' || !(GRANULARITIES as readonly string[]).includes(value)) {
    throw new BadRequestException('granularity must be day, week or month');
  }
  return value as Granularity;
}

/** `csv` when omitted; anything else is refused rather than guessed. */
export function parseFormat(value: unknown): ExportFormat {
  if (value === undefined || value === '' || value === null || value === 'csv') return 'csv';
  if (value === 'pdf') return 'pdf';
  throw new BadRequestException('format must be csv or pdf');
}
