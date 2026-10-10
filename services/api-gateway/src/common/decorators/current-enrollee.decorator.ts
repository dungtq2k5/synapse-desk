import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RequestOrigin } from '@synapsedesk/common';

/**
 * Who is enrolling, plus where from.
 *
 * Only `sub` and the observed origin, because that is all the two callers share:
 * a mid-challenge user has no organization, no departments and no permissions,
 * so anything richer would be absent exactly half the time.
 */
export type EnrolleeContext = RequestOrigin & { sub: string };

/**
 * The caller of a 2FA enrolment route, from EITHER identity.
 *
 * `@CurrentUser` cannot be used on these routes: it requires a full
 * `JwtPayload` and throws for a challenge payload — which is the one case
 * enrolment has to serve. Rather than loosening `@CurrentUser` (and with it
 * every route that relies on its strictness), this decorator asks for the
 * narrow thing both identities actually have.
 *
 * Requires `TwoFactorEnrolmentGuard` on the route. Without it `req.user` is
 * unset and this raises 401 rather than silently yielding an empty subject.
 */
export const CurrentEnrollee = createParamDecorator(
  (_data: unknown, context: ExecutionContext): EnrolleeContext => {
    const request = context.switchToHttp().getRequest<Request>();
    const sub = request.user?.sub;

    if (!sub) {
      throw new UnauthorizedException(
        'No authenticated caller — is TwoFactorEnrolmentGuard applied to this route?',
      );
    }

    return {
      sub,
      ip: request.ip ?? '',
      userAgent: request.get('user-agent') ?? '',
    };
  },
);
