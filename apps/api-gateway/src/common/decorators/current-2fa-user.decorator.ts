import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';
import { TwoFactorJwtPayload } from '@synapsedesk/common';

/**
 * The subject of an in-progress 2FA challenge.
 *
 * Deliberately NOT `@CurrentUser`: that decorator returns a full
 * `RequestContext` with permission codes, and a caller who has not yet cleared
 * the challenge has no permissions. Keeping the two decorators separate makes
 * it impossible to accidentally treat a half-authenticated request as a
 * complete one.
 */
export const Current2faUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TwoFactorJwtPayload => {
    const request =
      context.getType<string>() === 'graphql'
        ? GqlExecutionContext.create(context).getContext<{ req: Request }>().req
        : context.switchToHttp().getRequest<Request>();

    const payload = request.user as TwoFactorJwtPayload | undefined;
    if (!payload) {
      throw new InternalServerErrorException(
        '@Current2faUser was used on a route handler that is missing Jwt2faGuard',
      );
    }

    return payload;
  },
);
