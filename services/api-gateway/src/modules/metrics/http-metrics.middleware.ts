import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { GRAPHQL_PATH } from '../../common/config/graphql.config';
import { apiBasePath, resolveGlobalPrefix } from '../health/ops-routes';
import { MetricsRegistry } from './metrics.registry';

/** The `route` label of a request that matched no route: a 404. */
export const UNMATCHED_ROUTE = 'unmatched';

/**
 * The `route` label of a request a middleware refused before routing (origin,
 * Content-Type, size): it may have targeted a real route, so it doesn't share
 * the 404's label.
 */
export const REFUSED_BEFORE_ROUTING = 'refused-before-routing';

/**
 * RED metrics for every HTTP request: `http_requests_total` and
 * `http_request_duration_seconds`.
 *
 * Registered first, before every other middleware, guard and filter, so it
 * sees every request: one a handler served or threw from, and one a guard,
 * the throttler, the lifecycle gate, validation or a middleware refused. It
 * records on the response's `finish`, after the exception filter set the
 * status, so `status` is the status the client received.
 *
 * - **`route` is the path TEMPLATE** (`/api/v1/tickets/:id`), never the resolved
 *   path: one series per ticket otherwise, forever. A request with no template
 *   is `unmatched` (a 404) or `refused-before-routing`, two fixed labels that
 *   mint no series per guess.
 * - **Not counted:** GraphQL (its errors ride inside a 200, so this series
 *   can't measure them), CORS preflights (the browser asking, not a call), the
 *   generated documentation (`/docs`, `/docs-json`), and a request the client
 *   aborted (no `finish`, and `statusCode` would still
 *   read 200).
 *
 * @example recordHttpMetrics(app) // first, before any other app.use
 */
export function recordHttpMetrics(app: INestApplication): void {
  const metrics = app.get(MetricsRegistry);
  const docs = `${apiBasePath(
    resolveGlobalPrefix(
      app.get(ConfigService).getOrThrow<string>('GLOBAL_PREFIX'),
    ),
  )}/docs`;

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      isPreflight(request) ||
      request.path === GRAPHQL_PATH ||
      request.path.startsWith(docs)
    ) {
      next();
      return;
    }

    const started = process.hrtime.bigint();
    response.once('finish', () => {
      const labels = {
        route: routeOf(request, response.statusCode),
        method: request.method,
        status: String(response.statusCode),
      };
      metrics.httpRequests.inc(labels);
      metrics.httpDuration.observe(
        labels,
        Number(process.hrtime.bigint() - started) / 1e9,
      );
    });
    next();
  });
}

/** A CORS preflight: an OPTIONS asking which method it may use. */
function isPreflight(request: Request): boolean {
  return (
    request.method === 'OPTIONS' &&
    request.headers['access-control-request-method'] !== undefined
  );
}

/**
 * The route template a handler matched, under the prefix `baseUrl` carries; or
 * a fixed label when none did.
 *
 * Nest mounts a middleware bound to a path as an Express route for every method
 * (`all()`), and a refusal there leaves `req.route` pointing at it. A handler's
 * route answers one method (no `@All()` handler; `no-all-routes.spec.ts` holds
 * that), so a route answering several is a middleware's, and its refusal is
 * `refused-before-routing`.
 */
export function routeOf(request: Request, status: number): string {
  const route = request.route as
    { path?: string; methods?: Record<string, boolean> } | undefined;
  if (route?.path && Object.keys(route.methods ?? {}).length === 1) {
    return `${request.baseUrl ?? ''}${route.path}`;
  }

  return status === 404 ? UNMATCHED_ROUTE : REFUSED_BEFORE_ROUTING;
}
