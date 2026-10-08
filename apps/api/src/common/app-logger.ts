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
 *
 * The value has two shapes. A quoted value may contain spaces, so
 * `{"password": "correct horse battery"}` is read whole: the closing backreference
 * then matches and the alternative succeeds instead of dying at the first space
 * and leaving the secret in the clear. An unquoted value still stops at
 * whitespace and at the `;`, `,` and `}` delimiters. The other quote characters
 * stay excluded inside a quoted value, so a JSON value is never over-consumed.
 */
const KEY_VALUE_PAIR =
  /(["'`]?)([\p{L}_][\p{L}\p{N}_.-]*)\1(\s*[:=]\s*)(?:(["'`])([^"'\r\n]*)\4|([^\s"',;}]+))/gu;

function maskInline(text: string): string {
  const withoutAuth = text.replace(
    AUTH_HEADER,
    (_match, prefix, open, _value, close) => `${prefix}${open}***${close}`,
  );
  return withoutAuth.replace(
    KEY_VALUE_PAIR,
    (match, open, key, separator, quotedOpen: string | undefined) => {
      if (!isSecretKey(key)) return match;
      const quote = quotedOpen ?? '';
      return `${open}${key}${open}${separator}${quote}***${quote}`;
    },
  );
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

/**
 * Deep-masks secret-looking values. Cycles are cut off rather than thrown.
 *
 * The result is always JSON-safe: `write()` relies on it being serialisable, so
 * the two values `JSON.stringify` refuses are converted here rather than left to
 * throw at the call site.
 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  // A BigInt is a plain primitive, not an object, so the object branch below
  // would return it untouched and `JSON.stringify` would throw. It reaches the
  // logger easily (a numeric/bigint column), so it becomes its decimal string.
  if (typeof value === 'bigint') return value.toString();
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
  // An Invalid Date throws on toISOString(), which would abort the whole record.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
  }

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

    let record: LogRecord;
    let line: string;
    try {
      record = {
        time: new Date().toISOString(),
        level,
        // `msg` and `context` are just as log-bound as `data`: a caller that
        // interpolates a PIN into the event name leaked it in both the buffer
        // and stdout even though the same string in `data` was masked.
        msg: maskInline(msg),
      };
      if (context) record.context = maskInline(context);
      if (requestId) record.requestId = requestId;
      if (data !== undefined) record.data = redact(data);
      // Serialise BEFORE the buffer push. Pushing first left an unserialisable
      // record in the ring buffer, so the throw broke the caller's request and
      // every later `/diagnostics/logs` export too, until enough newer lines had
      // arrived to age the record out.
      line = JSON.stringify(record);
    } catch {
      // A payload that cannot be redacted or serialised is dropped. Failing the
      // request that merely logged something would be a far worse outcome.
      return;
    }

    this.buffer.push(record);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();

    try {
      process.stdout.write(`${line}\n`);
    } catch {
      // stdout can fail mid-write (EPIPE on a closed collector). Losing one line
      // is acceptable; throwing into the call site is not.
    }
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
   * Two shapes have to be told apart:
   *   log('sold', 'SalesService')                  -> message, context
   *   error('failed', 'Error: x\n at y', 'Ctx')    -> message, stack, context
   *   log({ orderId: 42 }, 'SalesService')         -> payload, context
   *
   * A multi-line string is a stack. Everything after the first argument that is a
   * string is context, and the context is never promoted to the message: an
   * object first argument means there is no message at all.
   */
  private nestArgs(message: unknown, optional: unknown[]): {
    msg: string;
    data?: unknown;
    context?: string;
  } {
    const head = message;
    const hasMessage = typeof head === 'string';

    let stack: string | undefined;
    let context: string | undefined;
    const payload: unknown[] = [];

    // An object first argument is the payload rather than the message, so it has
    // to be collected too; a string one is the message and must not be.
    if (!hasMessage) payload.push(head);

    for (const part of optional) {
      if (typeof part !== 'string') {
        payload.push(part);
      } else if (stack === undefined && part.includes('\n')) {
        stack = part;
      } else if (context === undefined) {
        context = part;
      }
    }

    const msg = hasMessage ? (head as string) : '<structured>';
    // The stack travels with the data rather than as its own field: it is the
    // diagnostic payload, and keeping one shape means the export stays simple.
    const extras = [stack, ...payload].filter((part) => part !== undefined);
    return { msg, data: extras.length > 0 ? extras : undefined, context };
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
