import { Injectable, type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { requestOf } from '../utils/execution-request.util';

/**
 * The access-token guard, on BOTH transports.
 *
 * **`AuthGuard` is HTTP-only until `getRequest` is overridden.** Passport's Nest
 * adapter calls `context.switchToHttp().getRequest()` and then `req.logIn(…)`;
 * under GraphQL that returns an empty object, so the guard fails with
 * `Cannot read properties of undefined (reading 'logIn')` — an error that names
 * passport internals and says nothing about transports.
 *
 * Overriding it is what makes the two surfaces share ONE authentication path
 * rather than have two. The property, stated directly: the
 * guards must populate the request identically on both, because every
 * authorization test elsewhere assumes it.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  override getRequest(context: ExecutionContext): Request {
    // `requestOf` is the same helper `@CurrentUser`, the throttler, the logger
    // and the lifecycle interceptor use — so a transport added later is added
    // once rather than five times, which is exactly how this gap appeared.
    return requestOf(context) as Request;
  }
}
