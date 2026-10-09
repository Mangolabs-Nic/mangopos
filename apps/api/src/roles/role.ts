/**
 * The three roles the database enforces. Mirrors `public.profiles.role` and the
 * helpers in migration `20260925000600_role_matrix.sql`; keep it in lockstep
 * with that CHECK constraint.
 */
export type Role = 'admin' | 'supervisor' | 'cashier';

export const ROLES: readonly Role[] = ['admin', 'supervisor', 'cashier'];

/** Narrows an untrusted value (e.g. a JWT claim) to a known role. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
