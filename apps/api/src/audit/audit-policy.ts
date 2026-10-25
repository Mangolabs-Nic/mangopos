import type { AuditRouteMetadata } from './audit.decorator.js';

/**
 * What the interceptor should record for a request, or `null` to leave it alone.
 *
 * The database trigger already records every row change, so a routine
 * `POST /products` needs no second entry. What the trigger cannot see is the
 * request itself: a login changes no row, and a void is only visible as the
 * UPDATE it produced, without the reason, the caller's address or whether the
 * request was refused. Those are the entries this policy selects.
 */
export interface AuditDecision {
  action: string;
  entityType: string;
  sensitive: boolean;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Routes whose event changes no row, so only the API can record it. */
const EVENT_ROUTES: ReadonlyArray<{
  pattern: RegExp;
  action: string;
  entityType: string;
  sensitive?: boolean;
}> = [
  { pattern: /^\/auth\/login\/?$/, action: 'auth.login', entityType: 'session' },
  { pattern: /^\/auth\/logout\/?$/, action: 'auth.logout', entityType: 'session' },
  { pattern: /^\/backups?\/?$/, action: 'backup.create', entityType: 'backup', sensitive: true },
];

/**
 * Routes that are sensitive by shape. Matching them here rather than relying on
 * a decorator means a route added without one is still recorded; the decorator
 * is then an override, not the only line of defence.
 */
const SENSITIVE_ROUTES: ReadonlyArray<{
  pattern: RegExp;
  action: string;
  entityType: string;
}> = [
  { pattern: /\/void\/?$/, action: 'sales.void', entityType: 'sales' },
  {
    pattern: /\/(?:stock-adjustments|stock\/adjust)\/?$/,
    action: 'stock.adjust',
    entityType: 'stock_adjustments',
  },
];

/** The first meaningful path segment: `/api/v1/stock-adjustments/9` -> `stock_adjustments`. */
export function entityTypeFromPath(path: string): string {
  const segments = path
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .filter((segment) => segment !== 'api' && !/^v\d+$/i.test(segment));
  return (segments[0] ?? 'request').replace(/-/g, '_');
}

/**
 * `null` means "the trigger owns this one". Anything else is an API entry.
 *
 * A decorator always wins on action and entity, but it cannot turn off
 * sensitivity for a `DELETE`: the flag is raised by the method, and the
 * database function raises it again for the same three operations.
 */
export function decideAudit(
  method: string,
  path: string,
  metadata?: AuditRouteMetadata,
): AuditDecision | null {
  const verb = method.toUpperCase();
  const clean = path.split('?')[0];
  const entityType = metadata?.entity ?? entityTypeFromPath(clean);

  if (metadata) {
    const byShape = verb === 'DELETE' || SENSITIVE_ROUTES.some((r) => r.pattern.test(clean));
    return {
      action: metadata.action,
      entityType,
      sensitive: byShape || metadata.sensitive === true,
    };
  }

  if (verb === 'DELETE') {
    return { action: `${entityType}.delete`, entityType, sensitive: true };
  }

  for (const route of SENSITIVE_ROUTES) {
    if (route.pattern.test(clean)) {
      return { action: route.action, entityType: route.entityType, sensitive: true };
    }
  }

  if (MUTATING_METHODS.has(verb)) {
    for (const route of EVENT_ROUTES) {
      if (route.pattern.test(clean)) {
        return {
          action: route.action,
          entityType: route.entityType,
          sensitive: route.sensitive === true,
        };
      }
    }
  }

  // A routine write: the AFTER trigger on the table records it, with the actual
  // before and after values. A read is never audited.
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The id the entry points at. `audit_log.entity_id` is a uuid column, so a
 * non-uuid path segment (a slug, `me`, a numeric legacy id) is dropped rather
 * than allowed to fail the insert.
 */
export function entityIdFromParams(params: Record<string, unknown> | undefined): string | null {
  if (!params) return null;
  for (const key of ['id', 'entityId', 'saleId', 'productId', 'userId']) {
    const value = params[key];
    if (typeof value === 'string' && UUID.test(value)) return value;
  }
  return null;
}
