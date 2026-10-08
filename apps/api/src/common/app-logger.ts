import { Injectable, LoggerService } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * Structured application logging.
 *
 * Emits one JSON object per line on stdout (the format Railway/Docker
 * aggregate) and keeps a bounded in-memory ring buffer so the diagnostics
 * endpoint can show recent activity and export it.
 *
 * Zero dependencies on purpose: Nest's built-in Logger is human-readable text,
 * not structured. This is the minimum that gives us machine-parseable logs.
 */

const LEVELS: Record<string, number> = {
  verbose: 10,
  debug: 20,
  log: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** Object keys whose values are always masked. */
const SECRET_KEY = /(pin|password|contrase|token|secret|authorization|cookie|api[_-]?key)/i;

/** Inline `pin=1234` / `"token": "abc"` style pairs inside free text. */
const SECRET_INLINE =
  /\b(pin|password|contrase\w*|token|secret|api[_-]?key|authorization)\b["']?\s*[=:]\s*["']?([^\s"',;}]+)["']?/gi;

export interface LogRecord {
  time: string;
  level: string;
  msg: string;
  requestId?: string;
  context?: string;
  data?: unknown;
}

function maskInline(text: string): string {
  return text.replace(SECRET_INLINE, (_m, key: string) => `${key}=***`);
}

/** Deep-masks secret-looking values. Cycles are cut off rather than thrown. */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return maskInline(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (value instanceof Error) {
    return { name: value.name, message: maskInline(value.message), stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? '***' : redact(item, seen);
  }
  return out;
}

@Injectable()
export class AppLogger implements LoggerService {
  private readonly buffer: LogRecord[] = [];
  private readonly bufferSize: number;
  private readonly minLevel: number;

  constructor() {
    this.bufferSize = Number(process.env.LOG_BUFFER_SIZE ?? 500);
    this.minLevel = LEVELS[process.env.LOG_LEVEL ?? 'log'] ?? LEVELS.log;
  }

  /** Core structured write. `msg` should be a stable, greppable event name. */
  write(level: string, msg: string, data?: unknown, context?: string): void {
    if ((LEVELS[level] ?? LEVELS.log) < this.minLevel) return;

    const record: LogRecord = {
      time: new Date().toISOString(),
      level,
      msg,
    };
    if (context) record.context = context;
    if (data !== undefined) record.data = redact(data);

    this.buffer.push(record);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();

    process.stdout.write(`${JSON.stringify(record)}\n`);
  }

  /** Capacity of the in-memory ring buffer. */
  get bufferCapacity(): number {
    return this.bufferSize;
  }

  /** Most recent records, newest last. */
  recent(limit = 100): LogRecord[] {
    return this.buffer.slice(-Math.max(1, limit));
  }

  count(): number {
    return this.buffer.length;
  }

  private nestArgs(message: unknown, optional: unknown[]): { msg: string; data?: unknown; context?: string } {
    const parts = [message, ...optional];
    const strings = parts.filter((p): p is string => typeof p === 'string');
    const rest = parts.filter((p) => typeof p !== 'string');
    // Nest appends the context class name as a trailing string.
    const context = strings.length > 1 ? strings[strings.length - 1] : undefined;
    const msg = strings[0] ?? (rest.length ? String(rest[0]) : '');
    return { msg, data: rest.length ? (rest.length === 1 ? rest[0] : rest) : undefined, context };
  }

  log(message: unknown, ...optional: unknown[]): void {
    const { msg, data, context } = this.nestArgs(message, optional);
    this.write('log', msg, data, context);
  }

  error(message: unknown, ...optional: unknown[]): void {
    const { msg, data, context } = this.nestArgs(message, optional);
    this.write('error', msg, data, context);
  }

  warn(message: unknown, ...optional: unknown[]): void {
    const { msg, data, context } = this.nestArgs(message, optional);
    this.write('warn', msg, data, context);
  }

  debug(message: unknown, ...optional: unknown[]): void {
    const { msg, data, context } = this.nestArgs(message, optional);
    this.write('debug', msg, data, context);
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    const { msg, data, context } = this.nestArgs(message, optional);
    this.write('verbose', msg, data, context);
  }

  fatal(message: unknown, ...optional: unknown[]): void {
    const { msg, data, context } = this.nestArgs(message, optional);
    this.write('fatal', msg, data, context);
  }

  newRequestId(): string {
    return randomUUID();
  }
}
