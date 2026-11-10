import { SetMetadata } from '@nestjs/common';

/**
 * Declares the audit identity of a route.
 *
 * A route with no `@Audit` still gets audited when it is sensitive by shape
 * (a `DELETE`, a void, a stock adjustment) or when it is one of the non-row
 * events (`auth.login`, `auth.logout`, `backup.create`). The decorator exists
 * for the routes where neither the method nor the path says what happened, and
 * for naming the entity precisely.
 */
export interface AuditRouteMetadata {
  /** `sales.void`, `stock.adjust`, `auth.login` — see the DB action pattern. */
  action: string;
  /** The `audit_log.entity_type`. Defaults to the first path segment. */
  entity?: string;
  /** Can raise sensitivity for a route the shape does not already mark. */
  sensitive?: boolean;
}

export const AUDIT_KEY = 'audit';

export const Audit = (metadata: AuditRouteMetadata) => SetMetadata(AUDIT_KEY, metadata);
