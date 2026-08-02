import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { isFullJwtPayload } from '@synapsedesk/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Jwt2faGuard } from './jwt-2fa.guard';

/**
 * Admits EITHER a fully authenticated caller or one mid-2FA-challenge.
 *
 * Enrolment is the one operation that both need. Without the second case a
 * tenant that turns on `enforce_two_factor` locks out every member who has not
 * already enrolled — INCLUDING the admin who flipped it:
 *
 *   1. login sees the policy, returns a 2FA challenge token and no access token
 *   2. `POST /auth/2fa/setup` needs an access token -> 401
 *   3. `POST /auth/2fa/authenticate` needs a CONFIGURED secret -> 412
 *
 * with no third door. That is a deadlock with no in-product way out, which is
 * why the toggle could not ship before this guard existed.
 *
 * **Why admitting the challenge token is safe.** It is only minted after a
 * password check, and both enrolment RPCs refuse an account whose 2FA is
 * already enabled (`FAILED_PRECONDITION`). So an attacker holding only the
 * password of a 2FA-protected account cannot use this door to replace the
 * victim's secret — the sole reachable case is an account with no second factor
 * yet, where the password is already the whole credential.
 *
 * Tries the full session FIRST so an ordinary voluntary enrolment keeps its
 * existing behaviour and error messages.
 */
@Injectable()
export class TwoFactorEnrolmentGuard implements CanActivate {
  constructor(
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly jwt2faGuard: Jwt2faGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (await this.tryGuard(this.jwtAuthGuard, context)) {
      const request = context.switchToHttp().getRequest<Request>();
      // A full session must be a FULL payload. Passport writes whichever
      // strategy matched, so without this check a challenge payload that
      // happened to satisfy the access strategy would pass as a real session.
      if (isFullJwtPayload(request.user)) return true;
    }

    if (await this.tryGuard(this.jwt2faGuard, context)) return true;

    throw new UnauthorizedException(
      'Enrolling in two-factor authentication requires a valid session or a live login challenge',
    );
  }

  /**
   * Both guards throw on failure rather than returning false, so "did this one
   * match?" has to be a caught exception. Only the FIRST is allowed to fail
   * silently — the second failing is a real 401, raised by the caller above
   * with a message covering both doors.
   */
  private async tryGuard(
    guard: CanActivate,
    context: ExecutionContext,
  ): Promise<boolean> {
    try {
      return (await guard.canActivate(context)) === true;
    } catch {
      return false;
    }
  }
}
