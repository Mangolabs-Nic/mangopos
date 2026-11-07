import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { Audit } from '../audit/audit.decorator.js';
import { bearerToken } from './bearer.js';
import type { AuthenticatedUser } from './auth.types.js';
import { AuthService, type CreateEmployeeInput } from './auth.service.js';
import { Public } from './public.decorator.js';
import { Roles } from '../roles/roles.decorator.js';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

interface PinBody {
  business?: unknown;
  pin?: unknown;
}

interface RecoverBody {
  email?: unknown;
  redirect_to?: unknown;
}

interface ConfirmRecoveryBody {
  access_token?: unknown;
  password?: unknown;
}

interface SetPinBody {
  pin?: unknown;
}

interface AuthRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
  auditActor?: { userId?: string; businessId?: string };
}

/**
 * Session endpoints.
 *
 * `@Public()` marks only the routes that cannot have a session yet. Logout, `/me`
 * and the employee management routes go through the global JWT guard, and the
 * admin ones add `@Roles('admin')` on top.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginBody, @Req() request: AuthRequest) {
    const { session, actor } = await this.auth.login(body?.email, body?.password);
    // The audit entry is written after this handler returns; naming the actor
    // here is what attributes a successful login to the person who made it.
    request.auditActor = { userId: actor.userId, businessId: actor.businessId };
    return session;
  }

  @Public()
  @Post('pin')
  @HttpCode(200)
  async pin(@Body() body: PinBody, @Req() request: AuthRequest) {
    const { session, actor } = await this.auth.pinLogin(body?.business, body?.pin, request.ip);
    request.auditActor = { userId: actor.userId, businessId: actor.businessId };
    return session;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: AuthRequest): Promise<void> {
    await this.auth.logout(bearerToken(request));
  }

  @Public()
  @Post('recover')
  @HttpCode(202)
  async recover(@Body() body: RecoverBody) {
    // The same answer whether or not the address exists; the mail is async.
    await this.auth.recover(body?.email, body?.redirect_to);
    return { accepted: true };
  }

  @Public()
  @Post('recover/confirm')
  @HttpCode(204)
  async confirmRecovery(@Body() body: ConfirmRecoveryBody): Promise<void> {
    await this.auth.confirmRecovery(body?.access_token, body?.password);
  }

  @Get('me')
  me(@Req() request: AuthRequest): AuthenticatedUser {
    return this.auth.me(request.user as AuthenticatedUser);
  }

  @Roles('admin')
  @Post('employees')
  @Audit({ action: 'employees.create', entity: 'profiles', sensitive: true })
  async createEmployee(@Body() body: CreateEmployeeInput, @Req() request: AuthRequest) {
    return this.auth.createEmployee(request.user as AuthenticatedUser, body ?? {});
  }

  @Roles('admin')
  @Put('employees/:id/pin')
  @HttpCode(204)
  @Audit({ action: 'profiles.pin_changed', entity: 'profiles', sensitive: true })
  async setPin(
    @Param('id') id: string,
    @Body() body: SetPinBody,
    @Req() request: AuthRequest,
  ): Promise<void> {
    await this.auth.setPin(request.user as AuthenticatedUser, id, body?.pin);
  }
}
