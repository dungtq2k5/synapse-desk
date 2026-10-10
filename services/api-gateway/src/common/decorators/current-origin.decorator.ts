import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestOrigin, UNKNOWN_ORIGIN } from '@synapsedesk/common';
import { requestOf } from '../utils/execution-request.util';

/**
 * The caller's OBSERVED provenance — `{ ip, userAgent }`.
 *
 * A decorator rather than a shared util, so a handler that only wants the
 * origin never touches the raw Express object, and provenance is read the same
 * way as identity via `@CurrentUser()`.
 *
 * Never populated from the body or a query param: `req.ip` is what the gateway
 * observed, and it is only the true client because `trust proxy` is set in
 * `main.ts`. Accepting a claimed IP would let a caller poison every audit row.
 *
 * Unlike `@CurrentUser()` this needs NO guard — provenance exists for anonymous
 * callers too, which is why login and password-reset can carry it.
 */
export const CurrentOrigin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestOrigin => {
    const request = requestOf(context);

    // `UNKNOWN_ORIGIN` rather than an inline `{ ip: '', userAgent: '' }` when
    // the transport carries no request -- `conventions - 4.3` names the one value.
    if (!request) return UNKNOWN_ORIGIN;

    return {
      ip: request.ip ?? '',
      userAgent: request.get('user-agent') ?? '',
    };
  },
);
