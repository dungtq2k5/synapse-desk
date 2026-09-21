import {
  Injectable,
  type NestMiddleware,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * A request that carries a body must declare `application/json`.
 *
 * **Measured on the built gateway before this existed**: `text/plain` with a
 * body was never a 415. Express's JSON parser simply skips a body it does not
 * recognise, so `req.body` arrived as `{}` and the request fell through to
 * validation — a caller who sent the right fields in the wrong content type
 * got back a list of missing fields, which points at the body rather than at
 * the header. Every one of the 88 body-taking routes declares
 * `application/json` and nothing else, so the rule is uniform.
 *
 * **In `AppModule`, not in a composition root.** `main.ts` and
 * `test/utils/bootstrap.ts` are two roots, and this repository has already
 * paid for that once: CORS lived only in `main.ts`, so no e2e test could
 * express the policy, let alone fail on it. Middleware registered here is
 * reached by both, and by the contract harness through the first.
 *
 * **Only when there IS a body.** A `POST` with no body and no `Content-Type`
 * is a legitimate request — `logout` is one — and refusing it would break
 * callers over a header they had no reason to send.
 */
@Injectable()
export class JsonBodyMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    if (!carriesABody(request)) {
      next();

      return;
    }

    const declared = request.headers['content-type'];

    if (!declared || !isJson(declared)) {
      // Thrown rather than answered here, so the ONE exception filter writes
      // the envelope. A `response.status(415).json(...)` in middleware is a
      // second place that has to know the error shape.
      throw new UnsupportedMediaTypeException(
        'Content-Type must be application/json',
      );
    }

    next();
  }
}

/**
 * Whether this request actually sent bytes.
 *
 * `Content-Length: 0` is not a body; a chunked request has no length at all,
 * which is why the transfer encoding is checked rather than assumed absent.
 */
function carriesABody(request: Request): boolean {
  const length = request.headers['content-length'];
  const chunked = (request.headers['transfer-encoding'] ?? '').includes(
    'chunked',
  );

  return chunked || (length !== undefined && Number(length) > 0);
}

/**
 * `application/json`, allowing what the wire really carries.
 *
 * A charset or boundary parameter is normal (`application/json; charset=utf-8`),
 * and a `+json` suffix is how a vendor media type says it is JSON
 * (`application/vnd.api+json`). Neither is a reason to refuse.
 */
function isJson(contentType: string): boolean {
  const essence = contentType.split(';')[0].trim().toLowerCase();

  return essence === 'application/json' || essence.endsWith('+json');
}
