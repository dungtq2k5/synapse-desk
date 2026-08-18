import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { requestOf } from '../utils/execution-request.util';

/**
 * Blocks `/auth/login` and `/auth/register` for callers who already hold a live
 * session, so one login does not silently overwrite another.
 *
 * **Only the access token is checked, deliberately.** The other two cookies
 * look relevant and are not:
 *
 * - `refresh_token` is opaque random bytes whose only authority is the
 *   `device_sessions` row it hashes to. The gateway cannot validate it without
 *   a round trip to auth-service, and treating mere *presence* as "logged in"
 *   would lock out anyone holding a stale or already-revoked cookie — they
 *   could never reach the login form to fix it. Failing open costs nothing: a
 *   user with a live refresh token who logs in again simply gets a new session.
 *
 * - `device_token` is not a session at all. It is the "remember this device"
 *   marker that suppresses the 2FA prompt, and it deliberately outlives every
 *   session issued alongside it. Someone whose session expired last week still
 *   has it, and they are exactly who needs the login page.
 *
 * This is a UX guard, not a security control — nothing is protected by it, so
 * failing open on any doubt is the correct bias.
 */
@Injectable()
export class GuestGuard implements CanActivate {
  private readonly JWT_ACCESS_NAME: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.JWT_ACCESS_NAME =
      this.configService.getOrThrow<string>('JWT_ACCESS_NAME');
  }

  canActivate(context: ExecutionContext): boolean {
    // `requestOf`, not `switchToHttp()`. This guard runs on
    // GraphQL too, where `switchToHttp()` returns an empty object and the read
    // below throws. The property that matters is that both transports are
    // guarded by the SAME code: a rule enforced on one and skipped on the other
    // is a rule with a hole in it that no test of either transport can see.
    const request = requestOf(context) as Request;
    const token = request.cookies?.[this.JWT_ACCESS_NAME] as string | undefined;
    if (!token) return true;

    try {
      // Cryptographic validation, not mere presence — an expired or tampered
      // token must not block the login form.
      this.jwtService.verify(token);
    } catch {
      // Expired, tampered, or signed by a retired key: let the request through
      // so the route can overwrite the cookie with a fresh one.
      //
      // Note the throw below sits OUTSIDE this try. Previously it was inside,
      // so the BadRequestException was caught by this same block and had to be
      // re-thrown by type — one refactor away from silently never firing.
      return true;
    }

    throw new BadRequestException(
      'You are already logged in with an active session.',
    );
  }
}
