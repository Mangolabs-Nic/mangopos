/**
 * The bearer token from the `Authorization` header, or `null`.
 *
 * Shared because both the auth routes and the report exports need the caller's
 * raw token: reports are queried through PostgREST with that token so the
 * database applies RLS, instead of with the service key that would bypass it.
 */
export interface RequestWithAuthHeader {
  headers?: Record<string, string | string[] | undefined>;
}

export function bearerToken(request: RequestWithAuthHeader): string | null {
  const header = request.headers?.authorization;
  if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}
