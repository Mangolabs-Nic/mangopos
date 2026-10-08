const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173'];

/**
 * Cross-origin policy.
 *
 * Two things live here because they are the same decision:
 *  - which origins may call the API at all
 *  - whether the diagnostics routes may be open
 *
 * The API holds tenant data, so an open `/diagnostics` behind a wildcard CORS
 * header means any web page a cashier visits can read the log export. The
 * diagnostics guard and the CORS allowlist must therefore be enabled together.
 */

/** Origins allowed to call the API. Empty in production means "nothing". */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.CORS_ALLOWED_ORIGINS;
  if (configured !== undefined) {
    const parsed = configured
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (parsed.length > 0) return parsed;
  }
  return env.NODE_ENV === 'production' ? [] : DEFAULT_ALLOWED_ORIGINS;
}

/**
 * The only spellings that count as "on". Anything else is off.
 *
 * `DIAGNOSTICS_PUBLIC` is an env var, so every value arrives as a string and a
 * plain truthiness test read `false` and `0` as true — an operator explicitly
 * turning diagnostics OFF got the opposite. This is a security gate, so an
 * unrecognised value must fail closed rather than open.
 */
const PUBLIC_TRUE = new Set(['true', '1', 'yes', 'on']);

function flagEnabled(raw: string | undefined): boolean {
  return raw !== undefined && PUBLIC_TRUE.has(raw.trim().toLowerCase());
}

/**
 * Diagnostics must be explicitly enabled when the API is not on localhost:
 * in production it is reachable from the internet, and the routes expose the
 * environment and the log export.
 */
export function diagnosticsOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DIAGNOSTICS_TOKEN) return false; // guarded by the token
  if (!flagEnabled(env.DIAGNOSTICS_PUBLIC)) return false;
  return env.NODE_ENV !== 'production';
}

export function corsOptions(env: NodeJS.ProcessEnv = process.env): {
  origin: string[] | boolean;
  credentials: boolean;
} {
  return {
    // `false` disables the CORS headers entirely rather than reflecting a wildcard.
    origin: allowedOrigins(env),
    credentials: true,
  };
}

/** Message for the boot log when diagnostics cannot be reached for support. */
export function diagnosticsExposureWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.DIAGNOSTICS_TOKEN) return null;
  if (diagnosticsOpen(env)) return null;
  return 'diagnostics are closed: set DIAGNOSTICS_TOKEN to reopen them for support';
}
