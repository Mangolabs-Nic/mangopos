import { AppLogger } from '../common/app-logger.js';
import type { AuditWriter } from './audit-entry.js';
import { LogAuditWriter } from './log-audit.writer.js';
import { SupabaseAuditWriter } from './supabase-audit.writer.js';

/**
 * Picks the writer once, at boot.
 *
 * Both variables are required: a URL without a key cannot authenticate, and a
 * key without a URL has nowhere to go. A half-configured environment falls back
 * to the log rather than failing every sensitive request, and `configured`
 * reporting in `/diagnostics` still shows whether the database is wired.
 */
export function auditWriterFromEnv(
  logger: AppLogger,
  env: NodeJS.ProcessEnv = process.env,
): AuditWriter {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_KEY?.trim();
  if (url && key) return new SupabaseAuditWriter(url, key);
  return new LogAuditWriter(logger);
}
