import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequestContextService } from '../contexts/request.context';

/**
 * Requires a proven email address.
 *
 * Stack it AFTER `JwtAuthGuard` on business routes — tickets, documents,
 * invitations, anything that sends mail or spends quota:
 *
 *     @UseGuards(JwtAuthGuard, EmailVerifiedGuard)
 *
 * It must NOT go on `/auth/*` or `/auth/email/verify*`: those are how an
 * unverified user becomes verified, and guarding them would deadlock the account
 * permanently.
 *
 * Reads `isEmailVerified` off the JWT rather than asking auth-service, so the
 * check costs nothing per request. The consequence is staleness — the claim is
 * only as fresh as the access token — which is why the SPA should call
 * `POST /auth/refresh` immediately after a successful verification. Until it
 * does, the user keeps hitting this guard even though the database says
 * otherwise.
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const requestContext = RequestContextService.fromRequest(request);
    if (!requestContext) {
      throw new UnauthorizedException('Authentication required');
    }

    // Super admins are platform staff created by the seeder, not by signup, so
    // there is no verification flow for them to have completed.
    if (requestContext.isSuperAdmin) return true;

    if (!requestContext.isEmailVerified) {
      throw new ForbiddenException(
        'Verify your email address to use this feature.',
      );
    }

    return true;
  }
}
