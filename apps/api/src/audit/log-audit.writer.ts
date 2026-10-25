import { AppLogger } from '../common/app-logger.js';
import type { AuditEntry, AuditWriter } from './audit-entry.js';

/**
 * Fallback writer for when the API has no database credentials.
 *
 * It emits the entry as a structured `audit_event` line instead of dropping it,
 * which keeps local development and a credential-less deployment honest: the
 * entry exists in the log export even though it is not in `audit_log` yet.
 * `AppLogger` already redacts, so a second pass is not needed here.
 */
export class LogAuditWriter implements AuditWriter {
  constructor(private readonly logger: AppLogger) {}

  write(entry: AuditEntry): Promise<void> {
    this.logger.write('log', 'audit_event', entry);
    return Promise.resolve();
  }
}
