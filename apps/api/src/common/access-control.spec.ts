import { describe, expect, it } from 'vitest';
import {
  allowedOrigins,
  corsOptions,
  diagnosticsOpen,
  diagnosticsExposureWarning,
} from './access-control.js';

const env = (overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv => overrides;

describe('diagnosticsOpen', () => {
  it('is closed in production without a token', () => {
    expect(diagnosticsOpen(env({ NODE_ENV: 'production' }))).toBe(false);
  });

  it('cannot be forced open in production', () => {
    expect(diagnosticsOpen(env({ NODE_ENV: 'production', DIAGNOSTICS_PUBLIC: 'true' }))).toBe(false);
  });

  it('is closed in development unless explicitly opened', () => {
    expect(diagnosticsOpen(env({ NODE_ENV: 'development' }))).toBe(false);
    expect(diagnosticsOpen(env({ NODE_ENV: 'development', DIAGNOSTICS_PUBLIC: 'true' }))).toBe(true);
  });

  it('is closed whenever a token is configured', () => {
    expect(diagnosticsOpen(env({ NODE_ENV: 'development', DIAGNOSTICS_TOKEN: 'secret' }))).toBe(false);
  });

  it.each(['false', 'FALSE', '0', 'no', 'off', '', '  ', 'truthy', 'enabled', '2'])(
    'treats DIAGNOSTICS_PUBLIC=%o as closed',
    (value) => {
      // A truthiness test read every one of these as true, so an operator asking
      // for closed got an open diagnostics surface.
      expect(diagnosticsOpen(env({ NODE_ENV: 'development', DIAGNOSTICS_PUBLIC: value }))).toBe(false);
    },
  );

  it('is closed when DIAGNOSTICS_PUBLIC is absent', () => {
    expect(diagnosticsOpen(env({ NODE_ENV: 'development' }))).toBe(false);
    expect(diagnosticsOpen(env({ NODE_ENV: 'staging' }))).toBe(false);
  });

  it.each(['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on', 'ON', ' true ', '\tOn\n'])(
    'treats DIAGNOSTICS_PUBLIC=%o as open outside production',
    (value) => {
      expect(diagnosticsOpen(env({ NODE_ENV: 'development', DIAGNOSTICS_PUBLIC: value }))).toBe(true);
    },
  );
});

describe('allowedOrigins', () => {
  it('allows nothing in production by default', () => {
    expect(allowedOrigins(env({ NODE_ENV: 'production' }))).toEqual([]);
  });

  it('never reflects a wildcard', () => {
    const options = corsOptions(env({ NODE_ENV: 'production' }));
    expect(options.origin).not.toBe('*');
    expect(options.origin).not.toBe(true);
  });

  it('parses an explicit allowlist', () => {
    expect(
      allowedOrigins(env({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://a.dev, https://b.dev' })),
    ).toEqual(['https://a.dev', 'https://b.dev']);
  });

  it('falls back to localhost in development', () => {
    expect(allowedOrigins(env({ NODE_ENV: 'development' }))).toEqual(['http://localhost:5173']);
  });
});

describe('diagnosticsExposureWarning', () => {
  it('is quiet when a token is set', () => {
    expect(diagnosticsExposureWarning(env({ NODE_ENV: 'production', DIAGNOSTICS_TOKEN: 'secret' }))).toBeNull();
  });

  it('warns when production diagnostics are shut', () => {
    expect(diagnosticsExposureWarning(env({ NODE_ENV: 'production' }))).toMatch(/closed/);
  });
});
