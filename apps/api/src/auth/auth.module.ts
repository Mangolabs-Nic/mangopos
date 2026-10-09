import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtVerificationService } from './jwt-verification.service.js';
import { ProfilesService } from './profiles.service.js';

/**
 * Owns the authentication dependencies. `app.module.ts` registers `JwtAuthGuard`
 * as the global `APP_GUARD`, so the guard and its collaborators are exported for
 * that registration to resolve.
 */
@Module({
  controllers: [AuthController],
  providers: [JwtAuthGuard, JwtVerificationService, ProfilesService],
  exports: [JwtAuthGuard, JwtVerificationService, ProfilesService],
})
export class AuthModule {}
