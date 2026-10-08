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

/**
 * Secret detection on key names.
 *
 * Matching a bare substring was too eager (`shipping` contains `pin`) and
 * matching the whole name was too strict (`accessToken`, `pinCode` and
 * `serviceRoleKey` slipped through). Splitting the name into words handles both:
 * camelCase, snake_case and kebab-case all reduce to the same tokens.
 */
const SECRET_WORDS = new Set([
  'pin',
  'pins',
  'password',
  'passwd',
  'pwd',
  'contrasena',
  'token',
  'tokens',
  'secret',
  'secrets',
  'authorization',
  'cookie',
  'credential',
  'credentials',
]);

/**
 * A qualifier glued to a secret word without a separator: `apikey`, `apiSecret`,
 * `accessToken`. After camelCase splitting only the all-lowercase forms reach here.
 */
const QUALIFIED_SECRET =
  /^(?:api|access|private|service|client|session|auth|signing|encryption|refresh|id)(?:key|secret|token|password|pin|credential)s?$/;

/** A trailing `key` counts only when qualified: `serviceRoleKey`, not `sortKey`. */
const KEY_QUALIFIERS = new Set([
  'api',
  'access',
  'auth',
  'client',
  'encryption',
  'private',
  'service',
  'session',
  'signing',
]);

function keyParts(key: string): string[] {
  return (
    key
      // The app is Spanish, so `contraseña` is a real field name. Stripping
      // diacritics first stops `ñ` from splitting the word in two, which would
      // leave `contrase` and `a` - neither of them a known secret.
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
}

export function isSecretKey(key: string): boolean {
  const parts = keyParts(key);
  if (parts.length === 0) return false;
  if (parts.some((part) => SECRET_WORDS.has(part) || QUALIFIED_SECRET.test(part))) return true;
  const last = parts[parts.length - 1];
  return last === 'key' && parts.slice(0, -1).some((part) => KEY_QUALIFIERS.has(part));
}

/**
 * `Authorization: Bearer abc` carries a scheme and then the credential, so masking
 * only the first token after the separator would leave the token itself visible.
 * Everything up to the end of the line is masked instead.
 */
const AUTH_HEADER =
  /((?:^|[\s,{;"'`])(?:proxy-)?authorization\s*["']?\s*[:=]\s*)(["'`]?)([^\r\n;,}"'`]*)(["'`]?)/gi;

/**
 * `key=value`, `"key": "value"` and `` `key`: `value` `` pairs in free text.
 * The key class is Unicode-aware so an accented name like `contraseña` is read
 * whole instead of stopping at the `ñ`.
 */
const KEY_VALUE_PAIR = /(["'`]?)([\p{L}_][\p{L}\p{N}_.-]*)\1(\s*[:=]\s*)(["'`]?)([^\s"',;}]+)\4/gu;

function maskInline(text: string): string {
  const withoutAuth = text.replace(
    AUTH_HEADER,
    (_match, prefix, open, _value, close) => `${prefix}${open}***${close}`,
  );
  return withoutAuth.replace(KEY_VALUE_PAIR, (match, open, key, separator, quote) => {
    if (!isSecretKey(key)) return match;
    return `${open}${key}${open}${separator}${quote}***${quote}`;
  });
}

export interface LogRecord {
  time: string;
  level: string;
  msg: string;
  requestId?: string;
  context?: string;
  data?: unknown;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Deep-masks secret-looking values. Cycles are cut off rather than thrown. */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return maskInline(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: maskInline(value.message),
      // The stack repeats the message, and message args can carry a PIN.
      stack: typeof value.stack === 'string' ? maskInline(value.stack) : value.stack,
    };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? '***' : redact(item, seen);
  }
  return out;
}

@Injectable()
export class AppLogger implements LoggerService {
  private readonly buffer: LogRecord[] = [];
  private readonly bufferSize: number;
  private readonly minLevel: number;

  constructor() {
    // A non-numeric value must not become NaN: `length > NaN` is always false,
    // which would turn the bounded buffer into an unbounded one.
    this.bufferSize = positiveInt(process.env.LOG_BUFFER_SIZE, 500);
    this.minLevel = LEVELS[process.env.LOG_LEVEL ?? 'log'] ?? LEVELS.log;
  }

  /** Core structured write. `msg` should be a stable, greppable event name. */
  write(level: string, msg: string, data?: unknown, context?: string, requestId?: string): void {
    if ((LEVELS[level] ?? LEVELS.log) < this.minLevel) return;

    const record: LogRecord = {
      time: new Date().toISOString(),
      level,
      msg,
    };
    if (context) record.context = context;
    if (requestId) record.requestId = requestId;
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

  /**
   * Split Nest's `(message, ...optional)` convention.
   *
   * Nest calls `error(message, stack, context)`, so a trailing string is the
   * stack rather than the context. Guessing wrong silently loses the stack, so
   * treat a multi-line string as the stack and only a single-line one as context.
   */
  private nestArgs(message: unknown, optional: unknown[]): {
    msg: string;
    data?: unknown;
    context?: string;
  } {
    const parts = [message, ...optional];
    const strings = parts.filter((part): part is string => typeof part === 'string');
    const rest = parts.filter((part) => typeof part !== 'string');

    let stack: string | undefined;
    let context: string | undefined;
    for (const candidate of strings.slice(1).reverse()) {
      if (stack === undefined && candidate.includes('\n')) stack = candidate;
      else if (context === undefined) context = candidate;
    }

    const msg = strings[0] ?? (rest.length ? String(rest[0]) : '');
    // The stack travels with the data rather than as its own field: it is the
    // diagnostic payload, and keeping one shape means the export stays simple.
    const data =
      stack !== undefined || rest.length ? [stack, ...rest].filter((part) => part !== undefined) : undefined;

    return { msg, data, context };
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

/**
 * Process-wide instance.
 *
 * Created lazily: main.ts calls process.loadEnvFile() before bootstrap(), and
 * module evaluation happens first, so a module-level `new AppLogger()` would read
 * LOG_LEVEL and friends before .env has been loaded.
 *
 * Both the logger handed to NestFactory and the injected provider resolve through
 * here, so there is exactly one ring buffer and `/diagnostics` sees every line,
 * including the ones Nest logs while the app is still starting.
 */
let instance: AppLogger | null = null;

export function getAppLogger(): AppLogger {
  instance ??= new AppLogger();
  return instance;
}
