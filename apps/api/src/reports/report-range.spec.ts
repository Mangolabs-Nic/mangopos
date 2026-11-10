import { describe, expect, it } from 'vitest';
import {
  parseFormat,
  parseGranularity,
  parseRange,
} from './report-range.js';

describe('parseRange', () => {
  it('accepts inclusive local dates', () => {
    expect(parseRange('2026-11-01', '2026-11-30')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
  });

  it('accepts a single day', () => {
    expect(parseRange('2026-11-07', '2026-11-07')).toEqual({
      from: '2026-11-07',
      to: '2026-11-07',
    });
  });

  it('refuses a missing or malformed date', () => {
    expect(() => parseRange(undefined, '2026-11-30')).toThrow(/YYYY-MM-DD/);
    expect(() => parseRange('2026-11-01', '30/11/2026')).toThrow(/YYYY-MM-DD/);
    expect(() => parseRange('2026-11-01', 20261130)).toThrow(/YYYY-MM-DD/);
  });

  it('refuses a calendar date that does not exist', () => {
    expect(() => parseRange('2026-02-30', '2026-03-01')).toThrow(/YYYY-MM-DD/);
  });

  it('refuses a reversed range', () => {
    expect(() => parseRange('2026-11-30', '2026-11-01')).toThrow(/on or before/);
  });
});

describe('parseGranularity', () => {
  it('defaults to day', () => {
    expect(parseGranularity(undefined)).toBe('day');
    expect(parseGranularity('')).toBe('day');
  });

  it('accepts the three buckets', () => {
    expect(parseGranularity('day')).toBe('day');
    expect(parseGranularity('week')).toBe('week');
    expect(parseGranularity('month')).toBe('month');
  });

  it('refuses anything else', () => {
    expect(() => parseGranularity('year')).toThrow(/day, week or month/);
  });
});

describe('parseFormat', () => {
  it('defaults to csv', () => {
    expect(parseFormat(undefined)).toBe('csv');
    expect(parseFormat('')).toBe('csv');
    expect(parseFormat('csv')).toBe('csv');
  });

  it('accepts pdf', () => {
    expect(parseFormat('pdf')).toBe('pdf');
  });

  it('refuses an unknown format instead of guessing', () => {
    expect(() => parseFormat('xlsx')).toThrow(/csv or pdf/);
  });
});
