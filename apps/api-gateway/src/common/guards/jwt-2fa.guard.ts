import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { requestOf } from '../utils/execution-request.util';

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
    // Was the only guard with a GraphQL branch, hand-written. Pointed at the
    // shared helper so the five places that now need it cannot drift — which is
    // how `@CurrentUser` and four other guards came to be missing theirs.
    return requestOf(context) as Request;
  }
}
