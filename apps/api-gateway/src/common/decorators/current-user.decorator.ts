import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { RequestContextService } from '../contexts/request.context';
import type { Request } from 'express';
import { RequestContext } from '@synapsedesk/common';

/**
 * @CurrentUser() → entire RequestContext
 * @CurrentUser('userId') → just the userId
 */
export const CurrentUser = createParamDecorator(
  <K extends keyof RequestContext>(
    data: K | undefined,
    ctx: ExecutionContext,
  ) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = RequestContextService.fromRequest(request);

    // Names the ACTUAL missing piece. It used to blame @RequirePermission, which
    // is a different mechanism entirely — that decorator only sets metadata and
    // never populates req.user, so the message sent you looking in the wrong
    // place. What fills req.user is an authenticating guard.
    if (!user) {
      throw new InternalServerErrorException(
        '@CurrentUser was used on a route handler with no authenticating guard. ' +
          'Add @UseGuards(JwtAuthGuard) — or, for a route mid-2FA-challenge, ' +
          'use @Current2faUser with Jwt2faGuard instead.',
      );
    }

    return data ? user[data] : user;
  },
);
