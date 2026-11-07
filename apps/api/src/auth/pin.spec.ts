import { describe, expect, it } from 'vitest';
import {
  addressHash,
  isValidPassword,
  isValidPin,
  normalizeEmail,
  normalizeSlug,
  pinLookup,
  pinPepper,
} from './pin.js';

describe('PIN format', () => {
  it.each(['1234', '0000', '123456', '12345678'])('accepts %s', (pin) => {
    expect(isValidPin(pin)).toBe(true);
  });

  it.each(['123', '123456789', '12a4', '', ' 1234', '1234 '])('rejects %o', (pin) => {
    expect(isValidPin(pin)).toBe(false);
  });
});

describe('pinLookup', () => {
  it('is a deterministic 64-character hex digest', () => {
    const first = pinLookup('1234', 'pepper-for-tests-0123456789');
    const second = pinLookup('1234', 'pepper-for-tests-0123456789');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with the PIN and with the pepper', () => {
    const base = pinLookup('1234', 'pepper-for-tests-0123456789');
    expect(pinLookup('4321', 'pepper-for-tests-0123456789')).not.toBe(base);
    expect(pinLookup('1234', 'another-pepper-0123456789')).not.toBe(base);
  });

  it('does not contain the PIN', () => {
    expect(pinLookup('987654', 'pepper-for-tests-0123456789')).not.toContain('987654');
  });
});

describe('addressHash', () => {
  it('is deterministic and hides the address', () => {
    const hash = addressHash('203.0.113.9', 'pepper-for-tests-0123456789');
    expect(hash).toBe(addressHash('203.0.113.9', 'pepper-for-tests-0123456789'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('203.0.113.9');
  });

  it('has a bucket for a missing address', () => {
    expect(addressHash(undefined, 'pepper-for-tests-0123456789')).toBe(
      addressHash('unknown', 'pepper-for-tests-0123456789'),
    );
  });
});

describe('input normalisation', () => {
  it('normalises a slug', () => {
    expect(normalizeSlug('  Mi-Tienda ')).toBe('mi-tienda');
    expect(normalizeSlug('mi tienda')).toBeNull();
    expect(normalizeSlug('-mi-tienda')).toBeNull();
    expect(normalizeSlug('')).toBeNull();
  });

  it('normalises an email', () => {
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
  });

  it('requires at least eight characters of password', () => {
    expect(isValidPassword('12345678')).toBe(true);
    expect(isValidPassword('1234567')).toBe(false);
    expect(isValidPassword(12345678)).toBe(false);
  });
});

describe('pinPepper', () => {
  it('fails closed without a long enough pepper', () => {
    expect(pinPepper({})).toBeNull();
    expect(pinPepper({ PIN_PEPPER: 'short' })).toBeNull();
    expect(pinPepper({ PIN_PEPPER: '   ' })).toBeNull();
    expect(pinPepper({ PIN_PEPPER: 'pepper-for-tests-0123456789' })).toBe(
      'pepper-for-tests-0123456789',
    );
  });
});
