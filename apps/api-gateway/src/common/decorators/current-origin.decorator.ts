import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';
import { RequestOrigin } from '@synapsedesk/common';

/**
 * The caller's OBSERVED provenance — `{ ip, userAgent }`.
 *
 * Replaces the `requestOrigin(request)` helper that each controller was
 * declaring for itself. Three reasons this shape rather than a shared util
 * function:
 *
 *   1. It removes `@Req() request: Request` from handlers that only wanted the
 *      origin, so a controller no longer touches the raw Express object at all.
 *   2. A util would still need importing and calling in every handler — the
 *      duplication moves rather than disappears.
 *   3. It is the same idiom as `@CurrentUser()`, so provenance and identity are
 *      read the same way.
 *
 * Never populated from the body or a query param: `req.ip` is what the gateway
 * observed, and it is only the true client because `trust proxy` is set in
 * main.ts. Accepting a claimed IP would let a caller poison every audit row.
 *
 * Unlike `@CurrentUser()` this needs NO guard — provenance exists for anonymous
 * callers too, which is why login and password-reset can carry it.
 */
export const CurrentOrigin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestOrigin => {
    const request =
      context.getType<string>() === 'graphql'
        ? GqlExecutionContext.create(context).getContext<{ req: Request }>().req
        : context.switchToHttp().getRequest<Request>();

    return {
      ip: request.ip ?? '',
      userAgent: request.get('user-agent') ?? '',
    };
  },
);
