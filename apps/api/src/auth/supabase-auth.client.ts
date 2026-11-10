import type { SupabaseSession } from './auth.types.js';

/**
 * Upstream failure with the status kept, but no response body.
 *
 * GoTrue echoes request details in some errors, and a request here carries an
 * email or a password. The caller maps the status to a generic message; the code
 * is for the log, not for the client.
 */
export class SupabaseAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** The upstream message, when there is one. Never surfaced verbatim. */
    readonly detail = '',
  ) {
    super(`supabase auth error ${status}`);
  }
}

interface GenerateLinkResponse {
  hashed_token?: string;
  email_otp?: string;
}

/**
 * The slice of Supabase Auth and PostgREST the API needs.
 *
 * A direct `fetch` rather than the SDK: the surface is seven endpoints, and every
 * extra dependency in the auth path is another thing to audit. No token is ever
 * logged and no error body is surfaced.
 */
export class SupabaseAuthClient {
  constructor(
    private readonly url: string,
    private readonly anonKey: string,
    private readonly serviceKey: string,
  ) {}

  get configured(): boolean {
    return Boolean(this.url && this.anonKey && this.serviceKey);
  }

  private async call<T>(
    target: string,
    init: RequestInit,
    key: string,
    bearer?: string,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    if (!this.configured) {
      throw new SupabaseAuthError(503, 'auth_not_configured');
    }

    const response = await fetch(target, {
      ...init,
      headers: {
        apikey: key,
        authorization: `Bearer ${bearer ?? key}`,
        'content-type': 'application/json',
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(5000),
    });

    const text = await response.text();
    if (!response.ok) {
      let code = 'upstream_error';
      let detail = '';
      try {
        const body = JSON.parse(text) as Record<string, unknown>;
        const candidate = body.error_code ?? body.code ?? body.msg ?? body.message;
        if (typeof candidate === 'string') code = candidate.slice(0, 120);
        const message = body.message ?? body.details ?? body.hint;
        if (typeof message === 'string') detail = message.slice(0, 300);
      } catch {
        // A non-JSON error body is not worth reading.
      }
      throw new SupabaseAuthError(response.status, code, detail);
    }

    if (text.length === 0) return {} as T;
    return JSON.parse(text) as T;
  }

  private auth(path: string): string {
    return `${this.url.replace(/\/+$/, '')}/auth/v1${path}`;
  }

  private rest(path: string): string {
    return `${this.url.replace(/\/+$/, '')}/rest/v1${path}`;
  }

  /** Email + password, the regular Supabase grant. */
  passwordSession(email: string, password: string): Promise<SupabaseSession> {
    return this.call<SupabaseSession>(
      this.auth('/token?grant_type=password'),
      { method: 'POST', body: JSON.stringify({ email, password }) },
      this.anonKey,
    );
  }

  /**
   * PIN login without knowing the account password.
   *
   * A one-time magic link is generated for the resolved email and immediately
   * exchanged for a session. Generation does not send mail, and the exchange is
   * what produces the same JWT every other login gets - PIN is a lookup, not a
   * second authentication stack.
   */
  async magicLinkSession(email: string): Promise<SupabaseSession> {
    const link = await this.call<GenerateLinkResponse>(
      this.auth('/admin/generate_link'),
      { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) },
      this.serviceKey,
    );

    if (typeof link.hashed_token !== 'string' || link.hashed_token.length === 0) {
      throw new SupabaseAuthError(502, 'magiclink_without_token');
    }

    return this.call<SupabaseSession>(
      this.auth('/verify'),
      {
        method: 'POST',
        body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
      },
      this.anonKey,
    );
  }

  async sendRecovery(email: string, redirectTo?: string): Promise<void> {
    // GoTrue reads `redirect_to` from the query string on /recover; sending it in
    // the JSON body is silently ignored and the mail falls back to `site_url`.
    const query = redirectTo
      ? `?${new URLSearchParams({ redirect_to: redirectTo }).toString()}`
      : '';
    await this.call<unknown>(
      this.auth(`/recover${query}`),
      { method: 'POST', body: JSON.stringify({ email }) },
      this.anonKey,
    );
  }

  async updatePassword(accessToken: string, password: string): Promise<void> {
    await this.call<unknown>(
      this.auth('/user'),
      { method: 'PUT', body: JSON.stringify({ password }) },
      this.anonKey,
      accessToken,
    );
  }

  async logout(accessToken: string): Promise<void> {
    await this.call<unknown>(
      this.auth('/logout'),
      { method: 'POST' },
      this.anonKey,
      accessToken,
    );
  }

  createUser(email: string, password: string): Promise<{ id: string; email?: string }> {
    return this.call<{ id: string; email?: string }>(
      this.auth('/admin/users'),
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          // Service-role only. handle_new_user() must not provision a throwaway
          // tenant for an employee the admin is about to attach to their own.
          app_metadata: { mangopos_provisioned: true },
        }),
      },
      this.serviceKey,
    );
  }

  async deleteUser(userId: string): Promise<void> {
    await this.call<unknown>(
      this.auth(`/admin/users/${encodeURIComponent(userId)}`),
      { method: 'DELETE' },
      this.serviceKey,
    );
  }

  /** Calls a SECURITY DEFINER function. The service key is required by design. */
  rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return this.call<T>(
      this.rest(`/rpc/${name}`),
      { method: 'POST', body: JSON.stringify(args) },
      this.serviceKey,
    );
  }

  /**
   * Calls a function with the caller's own JWT.
   *
   * PostgREST runs the request as `authenticated`, so `auth.uid()` and the RLS
   * policies decide what the row set contains. Report functions require this:
   * the service key would bypass the tenant rules they are supposed to inherit.
   */
  rpcAs<T>(accessToken: string, name: string, args: Record<string, unknown>): Promise<T> {
    return this.call<T>(
      this.rest(`/rpc/${name}`),
      { method: 'POST', body: JSON.stringify(args) },
      this.anonKey,
      accessToken,
    );
  }

  /**
   * A PostgREST table request with the caller's own JWT.
   *
   * Writes must go through the caller: RLS and the tenant triggers decide what
   * the row may contain, and the service key would hand every role the right to
   * write rows the policies were written to refuse.
   */
  restAs<T>(
    accessToken: string,
    method: string,
    path: string,
    body?: unknown,
    prefer?: string,
  ): Promise<T> {
    return this.call<T>(
      this.rest(path),
      {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      this.anonKey,
      accessToken,
      prefer ? { prefer } : undefined,
    );
  }

  /** Whether a profile exists in the caller's business, for the admin routes. */
  async profileInBusiness(userId: string, businessId: string): Promise<boolean> {
    const query = new URLSearchParams({
      id: `eq.${userId}`,
      business_id: `eq.${businessId}`,
      select: 'id',
      limit: '1',
    });
    const rows = await this.call<Array<{ id: string }>>(
      this.rest(`/profiles?${query.toString()}`),
      { method: 'GET' },
      this.serviceKey,
    );
    return Array.isArray(rows) && rows.length > 0;
  }
}

/** Built once at module construction; `configured` lets the service fail closed. */
export function createAuthClient(env: NodeJS.ProcessEnv = process.env): SupabaseAuthClient {
  return new SupabaseAuthClient(
    env.SUPABASE_URL?.trim() ?? '',
    env.SUPABASE_ANON_KEY?.trim() ?? '',
    env.SUPABASE_SERVICE_KEY?.trim() ?? '',
  );
}
