import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

/**
 * Authorizes the second leg of login using the `two_factor_token` cookie.
 *
 * `getRequest` is overridden so the guard works under GraphQL too: Apollo hides
 * the Express request inside its context, and Passport needs the real request to
 * find the cookie.
 */
@Injectable()
export class Jwt2faGuard extends AuthGuard('jwt-2fa') {
  override getRequest(context: ExecutionContext): Request {
    if (context.getType<string>() === 'graphql') {
      return GqlExecutionContext.create(context).getContext<{ req: Request }>()
        .req;
    }

    return context.switchToHttp().getRequest<Request>();
  }
}
