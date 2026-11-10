import type { AuditEntry, AuditWriter } from './audit-entry.js';

/**
 * Appends through the `audit_append` RPC with the service key.
 *
 * The key is used because the table has no write grant for any role and the
 * function is granted to `service_role` only. It stays on the server; nothing
 * here is ever sent to a client.
 *
 * `fetch` rather than a database driver on purpose: one RPC call does not
 * justify a connection pool, and Node 20+ ships fetch. The timeout is short
 * because the caller is a request path that must not wait on the trail.
 */
export class SupabaseAuditWriter implements AuditWriter {
  private readonly endpoint: string;

  constructor(
    supabaseUrl: string,
    private readonly serviceKey: string,
    private readonly timeoutMs = 2000,
  ) {
    this.endpoint = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/audit_append`;
  }

  async write(entry: AuditEntry): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        apikey: this.serviceKey,
        authorization: `Bearer ${this.serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        p_action: entry.action,
        p_entity_type: entry.entityType,
        p_business_id: entry.businessId,
        p_user_id: entry.userId,
        p_entity_id: entry.entityId,
        p_old_values: entry.oldValues,
        p_new_values: entry.newValues,
        p_metadata: entry.metadata,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      // The body is not read: an error payload can echo the request, and the
      // request may carry a reason. Status is enough to diagnose a grant or a
      // timeout, and `audit_write_failed` carries the entry itself.
      throw new Error(`audit_append returned ${response.status}`);
    }
  }
}
