/**
 * @file One reading of `CORS`, for the two transports that share it.
 *
 * **The variable was read two ways and they disagreed.** `main.ts` split it into
 * an array and handed that to the `cors` package, which matches an array by
 * exact string equality — so `['*']` matched nothing and every browser request
 * was refused with no `Access-Control-Allow-Origin` at all. The socket
 * decorator tested `has('*')` explicitly and allowed everything. One value,
 * `CORS = *`, produced the maximally restrictive HTTP policy and the maximally
 * permissive socket policy at the same time.
 *
 * Measured against `cors@2.8.6` rather than reasoned about:
 *
 * ```
 * origin: ["*"]                        ->  Access-Control-Allow-Origin: (unset)
 * origin: "*"                          ->  Access-Control-Allow-Origin: *
 * origin: ["http://localhost:5173"]    ->  Access-Control-Allow-Origin: http://localhost:5173
 * ```
 */

import {
  AUTH_THROTTLER_TIER,
  GENERAL_THROTTLER_TIERS,
} from './throttler.config';

/**
 * `*` means every origin; anything else is an exact allow-list.
 *
 * **The `.trim()` is load-bearing, not tidiness.** `dotenv` trims the whole
 * value and not around internal commas, so
 * `CORS = http://localhost:5173, http://localhost:3000` yields
 * `' http://localhost:3000'` with a leading space. Both matchers compare
 * exactly — `cors`'s array and the socket's `Set.has` — so that origin would be
 * refused over WebSocket while its neighbour worked over HTTP: the "app loads
 * but never updates" failure that sharing one variable exists to prevent,
 * reintroduced by the space a human puts after a comma.
 *
 * @param raw the `CORS` environment variable, verbatim.
 * @returns `'*'` for the wildcard — the shape `cors` treats as a wildcard — or
 *   the trimmed allow-list.
 */
export function corsOrigins(raw: string): '*' | string[] {
  const entries = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return entries.includes('*') ? '*' : entries;
}

/**
 * Methods the browser may use.
 *
 * `PUT` is here because four routes use it — the "replace the whole set" writes
 * for roles, permissions and department membership — and without it a front end
 * cannot change who can do what. `OPTIONS` is deliberately absent: the `cors`
 * middleware answers the preflight itself.
 */
export const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Headers a BROWSER is required to send — which is a superset of the headers a
 * controller reads.
 *
 * `@Headers('…')` finds the second set and misses Apollo's two entirely: no
 * handler reads them, the driver does. A list derived from controllers would
 * therefore have been complete and wrong.
 */
export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Requested-With',
  /**
   * Read by `POST /billing/plan`, and load-bearing: `always_invoice` means a
   * retried plan change is a second proration invoice. Its absence failed
   * QUIETLY — the request succeeds without it because the service derives a
   * key, so the front end looked fine while the guard was simply gone.
   */
  'Idempotency-Key',
  /**
   * Apollo's CSRF prevention, which is ON by default: `graphql.config.ts` never
   * sets `csrfPrevention`, and the absent option selects the recommended header
   * set. A browser Apollo Client sends one of these on every operation, so
   * without them `/graphql` fails at the preflight — with a CORS error about a
   * header the developer never knowingly sent, which reads as GraphQL being
   * broken rather than CORS being misconfigured.
   */
  'x-apollo-operation-name',
  'apollo-require-preflight',
];

/**
 * Headers the browser may READ off a response — derived from the throttler's
 * tier names, because those are what the headers are named after.
 *
 * `@nestjs/throttler` suffixes every header it writes with its tier:
 * `X-RateLimit-{Limit,Remaining,Reset}-<tier>` on each throttled response and
 * `Retry-After-<tier>` on a refusal, with no unsuffixed `X-RateLimit-*` at all.
 * `Retry-After` itself is what a client uses to recover from a 429;
 * `X-RateLimit-Remaining-<tier>` is what it uses to avoid one. A tier added to
 * the throttler is exposed here with no second edit.
 *
 * @example CORS_EXPOSED_HEADERS.includes('X-RateLimit-Remaining-authTier') // true
 */
export const CORS_EXPOSED_HEADERS = [
  'Retry-After',
  ...[...GENERAL_THROTTLER_TIERS, AUTH_THROTTLER_TIER].flatMap((tier) => [
    `X-RateLimit-Limit-${tier}`,
    `X-RateLimit-Remaining-${tier}`,
    `X-RateLimit-Reset-${tier}`,
    `Retry-After-${tier}`,
  ]),
];
