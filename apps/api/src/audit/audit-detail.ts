import { redact } from '../common/app-logger.js';

/**
 * The columns an API audit entry may copy out of a request body.
 *
 * This is the same explicit allowlist as `audit_safe_values()` in the database,
 * and it is an allowlist for the same reason: a denylist has to name the secret
 * before the secret exists, and `audit_log` is the one table from which nothing
 * can ever be deleted. A password, a PIN, a token, an email or any field added
 * later is dropped because it is not named here.
 *
 * The values are also passed through `redact()`: a free-text reason such as
 * "cliente olvidó su pin=1234" is masked, and the database filters the payload a
 * second time. Two layers, because this is the one write that cannot be undone.
 */
export const AUDIT_DETAIL_KEYS: readonly string[] = [
  'id',
  'business_id',
  'user_id',
  'product_id',
  'sale_id',
  'category_id',
  'payment_method_id',
  'role',
  'active',
  'name',
  'sku',
  'price',
  'cost',
  'stock',
  'quantity',
  'quantity_before',
  'quantity_after',
  'adjustment',
  'reason',
  'void_reason',
  'subtotal',
  'tax',
  'total',
  'amount',
  'status',
  'currency',
  'unit_price',
  'is_service',
  'created_at',
  'updated_at',
];

const ALLOWED = new Set(AUDIT_DETAIL_KEYS);

/** `null` unless the value is a plain object with at least one allowed scalar. */
export function auditDetail(source: unknown): Record<string, unknown> | null {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return null;

  const detail: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    // Nested objects and arrays are excluded wholesale: the allowlist is about
    // column names, and a payload inside an allowed name is still a payload.
    if (!ALLOWED.has(key) || value === null || typeof value === 'object') continue;
    detail[key] = redact(value);
  }

  return Object.keys(detail).length > 0 ? detail : null;
}
