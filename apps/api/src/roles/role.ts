/**
 * The three roles the database enforces. Mirrors `public.profiles.role` and the
 * helpers in migration `20260925000600_role_matrix.sql`; keep it in lockstep
 * with that CHECK constraint.
 */
export const ROLES = ['admin', 'supervisor', 'cashier'] as const;

/** The role union, derived from `ROLES` so the values and the type cannot drift. */
export type Role = (typeof ROLES)[number];

/** Narrows an untrusted value (e.g. a role resolved from `profiles`) to a known role. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
