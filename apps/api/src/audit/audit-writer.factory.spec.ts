import { describe, expect, it } from 'vitest';
import { AppLogger } from '../common/app-logger.js';
import { auditWriterFromEnv } from './audit-writer.factory.js';
import { LogAuditWriter } from './log-audit.writer.js';
import { SupabaseAuditWriter } from './supabase-audit.writer.js';

const logger = { write: () => undefined } as unknown as AppLogger;

describe('auditWriterFromEnv', () => {
  it('writes to the database when both credentials are present', () => {
    const writer = auditWriterFromEnv(
      logger,
      { SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_KEY: 'key' },
    );
    expect(writer).toBeInstanceOf(SupabaseAuditWriter);
  });

  it.each([
    {},
    { SUPABASE_URL: 'https://db.example.test' },
    { SUPABASE_SERVICE_KEY: 'key' },
    { SUPABASE_URL: '   ', SUPABASE_SERVICE_KEY: 'key' },
  ])('falls back to the structured log when the environment is incomplete (%o)', (env) => {
    expect(auditWriterFromEnv(logger, env)).toBeInstanceOf(LogAuditWriter);
  });
});
