import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtVerifier } from './jwt-verifier.js';
import { createAuthClient, SupabaseAuthClient } from './supabase-auth.client.js';

/**
 * Supabase Auth as the identity provider, plus the claim-based session the API
 * authorises against.
 *
 * `JwtVerifier` is exported for the global guard, which is registered in
 * `AppModule` so it runs before the roles guard in a known order.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: SupabaseAuthClient, useFactory: () => createAuthClient() },
    { provide: JwtVerifier, useFactory: () => new JwtVerifier() },
  ],
  exports: [JwtVerifier, SupabaseAuthClient],
})
export class AuthModule {}
