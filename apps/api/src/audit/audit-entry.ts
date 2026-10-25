/**
 * The shape of one append to `public.audit_log`, and the port that writes it.
 *
 * Keeping the transport behind an interface is what lets the trail be tested
 * without a database, and lets the same interceptor write through Supabase in
 * development and through the structured log when no credentials are set.
 */

/** One audit row, as the API builds it. Column names stay snake_case in the DB. */
export interface AuditEntry {
  businessId: string | null;
  userId: string | null;
  /** The operation, named: `sales.void`, `stock.adjust`, `auth.login`. */
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

/** The only writer the interceptor knows about. */
export interface AuditWriter {
  write(entry: AuditEntry): Promise<void>;
}

/** DI token: one writer per process, chosen at boot from the environment. */
export const AUDIT_WRITER = Symbol('AUDIT_WRITER');
