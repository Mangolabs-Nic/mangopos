import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseAuthClient, SupabaseAuthError } from './supabase-auth.client.js';

const URL_BASE = 'https://db.example.test';
const client = new SupabaseAuthClient(URL_BASE, 'anon-key', 'service-key');

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});

const failure = (status: number, body = '{}') => ({
  ok: false,
  status,
  text: async () => body,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SupabaseAuthClient', () => {
  it('grants a password session with the anon key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({ access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'bearer' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const session = await client.passwordSession('ana@example.com', 'secret123');

    expect(session.access_token).toBe('a');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${URL_BASE}/auth/v1/token?grant_type=password`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      apikey: 'anon-key',
      authorization: 'Bearer anon-key',
      'content-type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'ana@example.com',
      password: 'secret123',
    });
  });

  it('exchanges a magic link for a PIN session without sending mail', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ hashed_token: 'hash-1' }))
      .mockResolvedValueOnce(
        ok({ access_token: 'pin-token', refresh_token: 'r', expires_in: 3600, token_type: 'bearer' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const session = await client.magicLinkSession('emp@example.com');
    expect(session.access_token).toBe('pin-token');

    const [generateUrl, generateInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(generateUrl).toBe(`${URL_BASE}/auth/v1/admin/generate_link`);
    expect(generateInit.headers).toMatchObject({ apikey: 'service-key' });
    expect(JSON.parse(generateInit.body as string)).toEqual({
      type: 'magiclink',
      email: 'emp@example.com',
    });

    const [verifyUrl, verifyInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(verifyUrl).toBe(`${URL_BASE}/auth/v1/verify`);
    expect(verifyInit.headers).toMatchObject({ apikey: 'anon-key' });
    expect(JSON.parse(verifyInit.body as string)).toEqual({
      type: 'magiclink',
      token_hash: 'hash-1',
    });
  });

  it('refuses a magic link without a token hash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})));
    await expect(client.magicLinkSession('emp@example.com')).rejects.toMatchObject({
      status: 502,
    });
  });

  it('puts the recovery redirect in the query string GoTrue reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({}));
    vi.stubGlobal('fetch', fetchMock);

    await client.sendRecovery('ana@example.com', 'https://app.example.test/reset');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${URL_BASE}/auth/v1/recover?redirect_to=https%3A%2F%2Fapp.example.test%2Freset`,
    );
    expect(init.headers).toMatchObject({ apikey: 'anon-key' });
    expect(JSON.parse(init.body as string)).toEqual({ email: 'ana@example.com' });
  });

  it('sends a recovery mail without a redirect when none is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({}));
    vi.stubGlobal('fetch', fetchMock);

    await client.sendRecovery('ana@example.com');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${URL_BASE}/auth/v1/recover`);
    expect(JSON.parse(init.body as string)).toEqual({ email: 'ana@example.com' });
  });

  it('maps an upstream rejection without exposing its body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(failure(401, '{"msg":"Invalid login credentials"}')),
    );

    await expect(client.passwordSession('ana@example.com', 'wrong')).rejects.toMatchObject({
      status: 401,
      code: 'Invalid login credentials',
      message: 'supabase auth error 401',
    });
    await expect(client.passwordSession('ana@example.com', 'wrong')).rejects.not.toThrow(
      /wrong/,
    );
  });

  it('fails closed when the environment is incomplete', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(new SupabaseAuthClient('', 'anon', 'service').passwordSession('a@b.co', 'x')).rejects.toBeInstanceOf(
      SupabaseAuthError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls RPCs with the service key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await client.rpc('employee_pin_login', { p_business_slug: 'shop' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${URL_BASE}/rest/v1/rpc/employee_pin_login`);
    expect(init.headers).toMatchObject({ apikey: 'service-key', authorization: 'Bearer service-key' });
  });

  it('scopes the employee lookup to the caller business', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([{ id: 'u1' }]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(client.profileInBusiness('u1', 'b1')).resolves.toBe(true);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/rest/v1/profiles?');
    expect(url).toContain('business_id=eq.b1');
    expect(url).toContain('id=eq.u1');
  });

  it('marks an admin-created user so no throwaway tenant is provisioned', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ id: 'u1', email: 'e@x.co' }));
    vi.stubGlobal('fetch', fetchMock);

    await client.createUser('e@x.co', 'secret123');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${URL_BASE}/auth/v1/admin/users`);
    expect(JSON.parse(init.body as string)).toMatchObject({
      email: 'e@x.co',
      password: 'secret123',
      email_confirm: true,
      app_metadata: { mangopos_provisioned: true },
    });
  });
});
