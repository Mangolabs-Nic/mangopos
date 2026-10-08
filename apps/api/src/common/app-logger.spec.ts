import { describe, expect, it, beforeEach } from 'vitest';
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

  it('keeps non-secret values intact', () => {
    expect(redact({ total: 12.5, items: ['a', 'b'] })).toEqual({ total: 12.5, items: ['a', 'b'] });
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
  const written: string[] = [];
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    written.length = 0;
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      written.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    logger = new AppLogger();
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

  it('restores stdout', () => {
    process.stdout.write = originalWrite;
  });
});
