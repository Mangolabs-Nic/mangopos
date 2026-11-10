import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from './audit-entry.js';
import { SupabaseAuditWriter } from './supabase-audit.writer.js';

const entry: AuditEntry = {
  businessId: 'biz-1',
  userId: 'user-1',
  action: 'sales.void',
  entityType: 'sales',
  entityId: '3f0c9b6e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
  oldValues: null,
  newValues: { void_reason: 'cliente se fue' },
  metadata: { sensitive: true, request_id: 'req-1' },
};

describe('SupabaseAuditWriter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the audit_append RPC with the service key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await new SupabaseAuditWriter('https://db.example.test/', 'service-key').write(entry);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://db.example.test/rest/v1/rpc/audit_append');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      apikey: 'service-key',
      authorization: 'Bearer service-key',
      'content-type': 'application/json',
    });

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      p_action: 'sales.void',
      p_entity_type: 'sales',
      p_business_id: 'biz-1',
      p_user_id: 'user-1',
      p_new_values: { void_reason: 'cliente se fue' },
      p_metadata: { sensitive: true, request_id: 'req-1' },
    });
  });

  it('fails when the function refuses the entry, without reading the body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await expect(new SupabaseAuditWriter('https://db.example.test', 'key').write(entry)).rejects.toThrow(
      'audit_append returned 403',
    );
  });

  it('times out rather than holding the request open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError')),
    );

    await expect(new SupabaseAuditWriter('https://db.example.test', 'key').write(entry)).rejects.toThrow(
      /timed out/,
    );
  });
});
