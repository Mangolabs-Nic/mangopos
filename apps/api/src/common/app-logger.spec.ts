import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AppLogger, redact } from './app-logger.js';

describe('redact', () => {
  it('masks secret-looking object keys', () => {
    expect(redact({ pin: '1234', password: 'hunter2', name: 'ana' })).toEqual({
      pin: '***',
      password: '***',
      name: 'ana',
    });
  });

  it('masks inline secrets in strings', () => {
    expect(redact('login pin=9911 for user')).toBe('login pin=*** for user');
    expect(redact('{"token": "abcdef123456"}')).not.toContain('abcdef123456');
    expect(redact('{"pin": 9911}')).not.toContain('9911');
  });

  it.each([
    'access_token',
    'accessToken',
    'refreshToken',
    'pinCode',
    'set-cookie',
    'serviceRoleKey',
    'privateKey',
    'apiKey',
    'client_secret',
    'authorization',
    'password',
    'token',
    'pin',
  ])('masks the secret key %s', (key) => {
    expect(redact({ [key]: 's3cr3t-value' })).toEqual({ [key]: '***' });
    expect(redact(`${key}: "s3cr3t-value"`)).not.toContain('s3cr3t-value');
  });

  it.each(['shipping', 'tokenizer', 'spinning', 'sortKey', 'cacheKey', 'primaryKey', 'sku', 'moneda'])
    ('leaves the benign key %s alone', (key) => {
      expect(redact({ [key]: 'value-1' })).toEqual({ [key]: 'value-1' });
      expect(redact(`${key}: value-1`)).toContain('value-1');
    });

  it('keeps plain prose untouched', () => {
    expect(redact('venta 1234 registrada por el cajero')).toBe(
      'venta 1234 registrada por el cajero',
    );
  });

  it('survives circular references', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    expect(() => redact(node)).not.toThrow();
    expect((redact(node) as Record<string, unknown>).self).toBe('[circular]');
  });

  it('unwraps errors without losing the message', () => {
    const result = redact(new Error('boom')) as { name: string; message: string };
    expect(result.name).toBe('Error');
    expect(result.message).toBe('boom');
  });
});

describe('AppLogger', () => {
  let logger: AppLogger;
  let written: string[] = [];
  // Captured once, at module scope: re-capturing inside beforeEach would capture
  // the stub installed by the previous test and "restore" that instead.
  const realWrite = process.stdout.write.bind(process.stdout);

  beforeEach(() => {
    written = [];
    process.stdout.write = ((chunk: string) => {
      written.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    logger = new AppLogger();
  });

  afterEach(() => {
    process.stdout.write = realWrite;
  });

  it('emits one JSON object per line', () => {
    logger.write('log', 'sale_created', { total: 10 });
    expect(written).toHaveLength(1);
    const record = JSON.parse(written[0]);
    expect(record.msg).toBe('sale_created');
    expect(record.level).toBe('log');
    expect(record.data).toEqual({ total: 10 });
    expect(record.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('redacts data before writing', () => {
    logger.write('log', 'login', { pin: '1234' });
    expect(written[0]).not.toContain('1234');
    expect(written[0]).toContain('***');
  });

  it('keeps a bounded ring buffer', () => {
    process.env.LOG_BUFFER_SIZE = '5';
    const small = new AppLogger();
    delete process.env.LOG_BUFFER_SIZE;
    for (let i = 0; i < 12; i += 1) small.write('log', `event_${i}`);
    expect(small.bufferCapacity).toBe(5);
    expect(small.count()).toBe(5);
    expect(small.recent(100).map((r) => r.msg)).toEqual([
      'event_7',
      'event_8',
      'event_9',
      'event_10',
      'event_11',
    ]);
  });

  it('respects LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'warn';
    const quiet = new AppLogger();
    delete process.env.LOG_LEVEL;
    quiet.write('log', 'ignored');
    quiet.write('error', 'kept');
    const messages = written.map((line) => JSON.parse(line).msg);
    expect(messages).toEqual(['kept']);
  });

  it('treats a trailing Nest context string as the context', () => {
    logger.log('hello', 'AppService');
    const record = JSON.parse(written[0]);
    expect(record.msg).toBe('hello');
    expect(record.context).toBe('AppService');
  });

  it('hands out unique request ids', () => {
    expect(logger.newRequestId()).not.toBe(logger.newRequestId());
  });

  it('keeps the stack Nest passes to error(message, stack, context)', () => {
    logger.error('Something failed', 'Error: kaboom\n    at SaleService.sell (/app/src/sale.js:42:9)', 'SaleService');
    expect(written[0]).toContain('at SaleService.sell');
    expect(JSON.parse(written[0]).context).toBe('SaleService');
  });

  it('redacts a PIN that only appears in an Error stack', () => {
    logger.write('error', 'auth_failed', new Error('rejected pin=9911'));
    expect(written[0]).not.toContain('9911');
    expect(written[0]).toContain('***');
  });

  it('does not mistake shipping or tokenizer for a secret', () => {
    expect(redact({ shipping: 'Caribe', tokenizer: 'gpt' })).toEqual({
      shipping: 'Caribe',
      tokenizer: 'gpt',
    });
  });

  it('records the request id on the record', () => {
    logger.write('log', 'http_request', { path: '/x' }, undefined, 'req-123');
    expect(JSON.parse(written[0]).requestId).toBe('req-123');
  });

  it('falls back to the default buffer size when LOG_BUFFER_SIZE is not a number', () => {
    process.env.LOG_BUFFER_SIZE = 'abc';
    const guarded = new AppLogger();
    delete process.env.LOG_BUFFER_SIZE;
    expect(guarded.bufferCapacity).toBe(500);
    // An unbounded buffer would exceed the capacity after a burst of writes.
    for (let i = 0; i < 600; i += 1) guarded.write('log', `burst_${i}`);
    expect(guarded.count()).toBe(500);
  });
});
