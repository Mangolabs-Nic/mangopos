import type { Role } from '../roles/role.js';

/** The principal the JWT guard attaches to an authenticated request. */
export interface AuthenticatedUser {
  userId: string;
  businessId: string;
  appRole: Role;
}

/** The subset of Supabase Auth's session payload the API returns to a client. */
export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user?: { id: string; email?: string };
}

/** A session plus the principal its token carries. */
export interface SessionResult {
  session: SupabaseSession;
  actor: AuthenticatedUser;
}

export type PinLoginStatus = 'ok' | 'invalid' | 'locked';

/** What `public.employee_pin_login()` returns. */
export type PinLoginResult =
  | { status: 'ok'; user_id: string; email: string }
  | { status: 'invalid' }
  | { status: 'locked'; retry_after_seconds: number };
