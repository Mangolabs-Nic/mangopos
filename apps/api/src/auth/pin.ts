import { createHmac } from 'node:crypto';

/**
 * PIN handling for the API.
 *
 * The PIN never reaches the database and is never logged. What travels is
 * HMAC-SHA256(pin, PIN_PEPPER): a deterministic blind index the database can
 * match on without holding anything that can be reversed without the pepper.
 * A slow hash cannot be used here because lookup by PIN is the whole point; the
 * pepper is what keeps an offline dump from being an oracle.
 */

const PIN_FORMAT = /^\d{4,8}$/;
const SLUG_FORMAT = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_PASSWORD_LENGTH = 8;

export function isValidPin(value: unknown): value is string {
  return typeof value === 'string' && PIN_FORMAT.test(value);
}

export function normalizeSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  return SLUG_FORMAT.test(slug) ? slug : null;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return EMAIL_FORMAT.test(email) && email.length <= 254 ? email : null;
}

export function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH && value.length <= 128;
}

/** The blind index stored in `employee_pins.pin_lookup`. */
export function pinLookup(pin: string, pepper: string): string {
  return createHmac('sha256', pepper).update(pin, 'utf8').digest('hex');
}

/**
 * The address is hashed before it reaches `pin_attempts`: the limit only needs
 * to recognise the same caller, not to keep a record of who was where.
 */
export function addressHash(address: string | undefined, pepper: string): string {
  const value = address?.trim() || 'unknown';
  return createHmac('sha256', pepper).update(`address:${value}`, 'utf8').digest('hex');
}

/** `null` when the pepper is missing; PIN login must fail closed, not default. */
export function pinPepper(env: NodeJS.ProcessEnv = process.env): string | null {
  const pepper = env.PIN_PEPPER?.trim();
  return pepper && pepper.length >= 16 ? pepper : null;
}
