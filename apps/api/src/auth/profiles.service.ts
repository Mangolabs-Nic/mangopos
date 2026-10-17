import { Injectable, UnauthorizedException } from '@nestjs/common';
import pg from 'pg';
import { isRole, type Role } from '../roles/role.js';

interface ProfileRow {
  role: string;
  business_id: string;
  active: boolean;
}

export interface ResolvedProfile {
  appRole: Role;
  businessId: string;
}

/**
 * Turns a verified Supabase user id into the principal the app actually uses:
 * the role mirrored in `public.profiles` and the business that row belongs to.
 *
 * Reads the database on every call on purpose: `roles.guard.ts` documents that a
 * demotion must take effect on the next request, so a cached role would defeat
 * the freshness the schema is designed for.
 */
@Injectable()
export class ProfilesService {
  private poolInstance?: pg.Pool;

  async resolve(sub: string): Promise<ResolvedProfile> {
    const { rows } = await this.getPool().query<ProfileRow>(
      'SELECT role, business_id, active FROM public.profiles WHERE id = $1',
      [sub],
    );
    const profile = rows[0];
    // No row, a deactivated account, or a role the CHECK constraint would never
    // write: all unusable principals, all 401 (the token is valid but the caller
    // is not a current, active member of any business).
    if (!profile || profile.active !== true || !isRole(profile.role)) {
      throw new UnauthorizedException('authentication required');
    }
    return { appRole: profile.role, businessId: profile.business_id };
  }

  private getPool(): pg.Pool {
    return (this.poolInstance ??= new pg.Pool({ connectionString: process.env.DATABASE_URL }));
  }
}
