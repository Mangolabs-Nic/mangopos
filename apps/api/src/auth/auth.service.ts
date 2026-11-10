import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AppLogger } from '../common/app-logger.js';
import { isRole, type Role } from '../roles/role.js';
import type {
  AuthenticatedUser,
  PinLoginResult,
  SessionResult,
  SupabaseSession,
} from './auth.types.js';
import { JwtConfigError, JwtVerifier } from './jwt-verifier.js';
import {
  addressHash,
  isValidPassword,
  isValidPin,
  normalizeEmail,
  normalizeSlug,
  pinLookup,
  pinPepper,
} from './pin.js';
import { SupabaseAuthClient, SupabaseAuthError } from './supabase-auth.client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateEmployeeInput {
  email?: unknown;
  password?: unknown;
  role?: unknown;
  pin?: unknown;
}

/**
 * Authentication flows.
 *
 * Every session - password, PIN, recovery - ends in a Supabase access token that
 * `JwtVerifier` accepts, and every actor comes from those verified claims rather
 * than from the request body. That is the point of routing PIN login through
 * `magicLinkSession`: there is one kind of session, not two.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly client: SupabaseAuthClient,
    private readonly verifier: JwtVerifier,
    private readonly logger: AppLogger,
  ) {}

  async login(email: unknown, password: unknown): Promise<SessionResult> {
    const address = normalizeEmail(email);
    if (!address) throw new BadRequestException('a valid email is required');
    if (!isValidPassword(password)) {
      throw new BadRequestException('password must be at least 8 characters');
    }

    let session: SupabaseSession;
    try {
      session = await this.client.passwordSession(address, password);
    } catch (error) {
      this.fail(error, 'invalid credentials');
    }

    return { session, actor: await this.actorOf(session) };
  }

  /**
   * PIN login: business slug + PIN, resolved by the database, exchanged for a
   * session for the email it resolved to. The PIN never leaves this process in
   * clear - the database only sees its HMAC.
   */
  async pinLogin(business: unknown, pin: unknown, ip: string | undefined): Promise<SessionResult> {
    const pepper = pinPepper();
    if (!pepper) {
      this.logger.write('warn', 'pin_login_closed', {
        hint: 'set PIN_PEPPER to enable employee PIN login',
      });
      throw new ServiceUnavailableException('pin login is not configured');
    }

    const slug = normalizeSlug(business);
    if (!slug) throw new BadRequestException('a valid business slug is required');
    if (!isValidPin(pin)) throw new BadRequestException('a PIN is 4 to 8 digits');

    let result: PinLoginResult;
    try {
      result = await this.client.rpc<PinLoginResult>('employee_pin_login', {
        p_business_slug: slug,
        p_pin_lookup: pinLookup(pin, pepper),
        p_ip_hash: addressHash(ip, pepper),
      });
    } catch (error) {
      this.fail(error, 'invalid credentials', 'upstream');
    }

    if (result?.status === 'locked') {
      throw new HttpException(
        { statusCode: 429, message: 'too many attempts', retry_after_seconds: result.retry_after_seconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (result?.status !== 'ok') throw new UnauthorizedException('invalid credentials');

    let session: SupabaseSession;
    try {
      session = await this.client.magicLinkSession(result.email);
    } catch (error) {
      this.fail(error, 'invalid credentials', 'upstream');
    }

    const actor = await this.actorOf(session);
    if (actor.userId !== result.user_id) {
      // The PIN resolved to one account and the session to another. That cannot
      // be a legitimate login; refuse it rather than hand out the wrong identity.
      this.logger.write('error', 'pin_session_mismatch', { resolved: result.user_id, session: actor.userId });
      throw new UnauthorizedException('invalid credentials');
    }

    return { session, actor };
  }

  /** Idempotent: an already-invalid session is still a completed logout. */
  async logout(accessToken: string | null): Promise<void> {
    if (!accessToken) return;
    try {
      await this.client.logout(accessToken);
    } catch (error) {
      this.logger.write('warn', 'logout_failed', this.describe(error));
    }
  }

  /**
   * Sends the built-in recovery mail. The answer is always the same, successful
   * or not, so the endpoint cannot be used to discover which emails have accounts.
   */
  async recover(email: unknown, redirectTo?: unknown): Promise<void> {
    const address = normalizeEmail(email);
    if (!address) return;

    try {
      await this.client.sendRecovery(
        address,
        typeof redirectTo === 'string' && redirectTo.length > 0 ? redirectTo : undefined,
      );
    } catch (error) {
      if (error instanceof SupabaseAuthError && error.status === 429) {
        throw new HttpException('too many requests', HttpStatus.TOO_MANY_REQUESTS);
      }
      this.logger.write('warn', 'recovery_mail_failed', this.describe(error));
    }
  }

  /** Completes the built-in recovery flow with the token from the email link. */
  async confirmRecovery(accessToken: unknown, password: unknown): Promise<void> {
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new BadRequestException('the recovery token is required');
    }
    if (!isValidPassword(password)) {
      throw new BadRequestException('password must be at least 8 characters');
    }

    try {
      await this.client.updatePassword(accessToken, password);
    } catch (error) {
      if (error instanceof SupabaseAuthError && (error.status === 401 || error.status === 403)) {
        throw new UnauthorizedException('invalid or expired recovery link');
      }
      this.fail(error, 'the password could not be changed');
    }
  }

  /**
   * Admin creates an employee: an auth user, a profile in the admin's business,
   * and a PIN. If a later step fails the auth user is removed again, so a
   * half-created employee does not exist.
   */
  async createEmployee(
    actor: AuthenticatedUser,
    input: CreateEmployeeInput,
  ): Promise<{ user_id: string; email: string; role: Role }> {
    const email = normalizeEmail(input.email);
    if (!email) throw new BadRequestException('a valid email is required');
    if (!isValidPassword(input.password)) {
      throw new BadRequestException('password must be at least 8 characters');
    }
    if (!isRole(input.role)) throw new BadRequestException('role must be admin, supervisor or cashier');
    if (!isValidPin(input.pin)) throw new BadRequestException('a PIN is 4 to 8 digits');

    const pepper = this.requirePepper();
    const role = input.role;

    let created: { id: string; email?: string };
    try {
      created = await this.client.createUser(email, input.password);
    } catch (error) {
      if (error instanceof SupabaseAuthError && (error.status === 409 || error.status === 422)) {
        throw new ConflictException('that email is already registered');
      }
      this.fail(error, 'the employee could not be created', 'upstream');
    }

    try {
      await this.client.rpc('provision_user_for_business', {
        target_user_id: created.id,
        target_business: actor.businessId,
        target_role: role,
      });
      await this.client.rpc('set_employee_pin', {
        p_user_id: created.id,
        p_pin_lookup: pinLookup(input.pin, pepper),
      });
    } catch (error) {
      await this.compensate(created.id);
      if (error instanceof SupabaseAuthError && error.status === 409) {
        throw new ConflictException('that PIN is already in use in this business');
      }
      this.fail(error, 'the employee could not be provisioned', 'upstream');
    }

    return { user_id: created.id, email, role };
  }

  /** Admin resets an employee PIN. The target must belong to the admin's business. */
  async setPin(actor: AuthenticatedUser, userId: unknown, pin: unknown): Promise<void> {
    if (typeof userId !== 'string' || !UUID.test(userId)) {
      throw new BadRequestException('a valid employee id is required');
    }
    if (!isValidPin(pin)) throw new BadRequestException('a PIN is 4 to 8 digits');

    const pepper = this.requirePepper();

    let belongs: boolean;
    try {
      belongs = await this.client.profileInBusiness(userId, actor.businessId);
    } catch (error) {
      this.fail(error, 'the employee could not be updated', 'upstream');
    }
    if (!belongs) throw new NotFoundException('employee not found');

    try {
      await this.client.rpc('set_employee_pin', {
        p_user_id: userId,
        p_pin_lookup: pinLookup(pin, pepper),
      });
    } catch (error) {
      if (error instanceof SupabaseAuthError && error.status === 409) {
        throw new ConflictException('that PIN is already in use in this business');
      }
      this.fail(error, 'the employee could not be updated', 'upstream');
    }
  }

  me(actor: AuthenticatedUser): AuthenticatedUser {
    return actor;
  }

  private requirePepper(): string {
    const pepper = pinPepper();
    if (!pepper) {
      this.logger.write('warn', 'pin_login_closed', {
        hint: 'set PIN_PEPPER to enable employee PIN management',
      });
      throw new ServiceUnavailableException('pin login is not configured');
    }
    return pepper;
  }

  /**
   * The actor is read from the token this API just received from Supabase, not
   * from a request field. It also proves the claims hook is enabled: a token
   * without `business_id` cannot be placed and is not a usable session.
   */
  private async actorOf(session: SupabaseSession): Promise<AuthenticatedUser> {
    try {
      return await this.verifier.verify(session.access_token);
    } catch (error) {
      if (error instanceof JwtConfigError) {
        throw new ServiceUnavailableException('authentication is not configured');
      }
      this.logger.write('error', 'auth_claims_missing', { hint: 'is the custom access token hook enabled?' });
      throw new ServiceUnavailableException('authentication is not fully configured');
    }
  }

  private async compensate(userId: string): Promise<void> {
    try {
      await this.client.deleteUser(userId);
    } catch (error) {
      this.logger.write('error', 'employee_provision_compensation_failed', {
        userId,
        ...this.describe(error),
      });
    }
  }

  /** Maps an upstream failure to an HTTP answer without leaking its body. */
  private fail(error: unknown, message: string, kind: 'credentials' | 'upstream' = 'credentials'): never {
    if (error instanceof SupabaseAuthError) {
      const detail = { status: error.status, code: error.code };
      if (kind === 'credentials' && (error.status === 400 || error.status === 401 || error.status === 403)) {
        this.logger.write('warn', 'auth_rejected', detail);
        throw new UnauthorizedException(message);
      }
      if (error.status === 409) throw new ConflictException('that record already exists');
      if (error.status === 422) throw new BadRequestException('the request was rejected');
      if (error.status === 429) {
        throw new HttpException('too many requests', HttpStatus.TOO_MANY_REQUESTS);
      }
      if (error.status === 503) {
        throw new ServiceUnavailableException('authentication is not configured');
      }
      this.logger.write('error', 'auth_upstream_failed', detail);
      throw new BadGatewayException('the authentication service is unavailable');
    }

    this.logger.write('error', 'auth_upstream_failed', this.describe(error));
    throw new BadGatewayException('the authentication service is unavailable');
  }

  private describe(error: unknown): Record<string, unknown> {
    if (error instanceof SupabaseAuthError) {
      return { status: error.status, code: error.code };
    }
    if (error instanceof Error) return { name: error.name, message: error.message };
    return { error: String(error) };
  }
}
