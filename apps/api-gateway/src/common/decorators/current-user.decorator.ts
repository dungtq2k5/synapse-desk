import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { RequestContextService } from '../contexts/request.context';
import { RequestContext } from '@synapsedesk/common';
import { requestOf } from '../utils/execution-request.util';

/**
 * `@CurrentUser()` → the entire `RequestContext`; `@CurrentUser('sub')` → one
 * field of it.
 *
 * **Works in a RESOLVER as well as a controller** step 1, closing
 * docs/reference/known-gaps.md #6. It used to call `switchToHttp()` unconditionally, which
 * returns an empty object under GraphQL: `RequestContextService.fromRequest`
 * then found no user and this threw "no authenticating guard" at a resolver
 * whose guard had run perfectly. The message sent you looking at the guard,
 * which was not the problem.
 *
 * Blocking for the whole GraphQL surface, because every resolver needs the
 * caller — which is why it is step 1 of the build order rather than a detail.
 */
export const CurrentUser = createParamDecorator(
  <K extends keyof RequestContext>(
    data: K | undefined,
    ctx: ExecutionContext,
  ) => {
    // The one line that made this HTTP-only. See `requestOf`.
    const request = requestOf(ctx);
    const user = request && RequestContextService.fromRequest(request);

    // Names the ACTUAL missing piece. It used to blame @RequirePermission, which
    // is a different mechanism entirely — that decorator only sets metadata and
    // never populates req.user, so the message sent you looking in the wrong
    // place. What fills req.user is an authenticating guard.
    if (!user) {
      throw new InternalServerErrorException(
        '@CurrentUser was used on a handler with no authenticating guard. ' +
          'Add @UseGuards(JwtAuthGuard) — or, for a route mid-2FA-challenge, ' +
          'use @Current2faUser with Jwt2faGuard instead. In a resolver, the ' +
          'guard goes on the @Resolver class exactly as it goes on a controller.',
      );
    }

    return data ? user[data] : user;
  },
);
