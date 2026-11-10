import { Inject, Injectable } from '@nestjs/common';
import { AppLogger } from '../common/app-logger.js';
import { AUDIT_WRITER, type AuditEntry, type AuditWriter } from './audit-entry.js';

/**
 * Writes audit entries without ever failing the request that produced them.
 *
 * The trade-off is deliberate and it is the only defensible one for a POS: a
 * database that refuses the audit append must not also refuse the sale, because
 * a lost sale is worse than a late entry. The failure is not swallowed either -
 * it is written to the structured log at `error` with the full (already
 * redacted) entry, so `/diagnostics/logs` still holds the evidence and the
 * outage is visible instead of silent.
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(AUDIT_WRITER) private readonly writer: AuditWriter,
    private readonly logger: AppLogger,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.writer.write(entry);
    } catch (error) {
      this.logger.write('error', 'audit_write_failed', { entry, error });
    }
  }
}
