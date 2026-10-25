import { describe, expect, it, vi } from 'vitest';
import { AppLogger } from '../common/app-logger.js';
import { AuditService } from './audit.service.js';
import type { AuditEntry } from './audit-entry.js';

const entry: AuditEntry = {
  businessId: 'biz-1',
  userId: 'user-1',
  action: 'sales.void',
  entityType: 'sales',
  entityId: null,
  oldValues: null,
  newValues: { void_reason: 'cliente se fue' },
  metadata: { sensitive: true },
};

describe('AuditService', () => {
  it('writes through the configured writer', async () => {
    const write = vi.fn<(entry: AuditEntry) => Promise<void>>().mockResolvedValue(undefined);
    const log = vi.fn();
    const logger = { write: log } as unknown as AppLogger;

    await new AuditService({ write }, logger).record(entry);

    expect(write).toHaveBeenCalledWith(entry);
    expect(log).not.toHaveBeenCalled();
  });

  it('keeps the evidence in the log when the writer fails, and does not throw', async () => {
    const write = vi.fn<(entry: AuditEntry) => Promise<void>>().mockRejectedValue(
      new Error('database down'),
    );
    const log = vi.fn();
    const logger = { write: log } as unknown as AppLogger;

    await expect(new AuditService({ write }, logger).record(entry)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      'error',
      'audit_write_failed',
      expect.objectContaining({ entry }),
    );
  });
});
