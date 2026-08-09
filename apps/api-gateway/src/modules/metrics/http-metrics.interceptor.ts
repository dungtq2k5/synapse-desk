import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsRegistry } from './metrics.registry';

/**
 * RED metrics for every HTTP request — 23-doc §4.
 *
 * **The `route` label is the PATH TEMPLATE, never the resolved path.** This is
 * §4's test 3 and it is the same cardinality trap wearing different clothes:
 * `/tickets/<uuid>` looks like a route label and is per-ticket cardinality, so a
 * busy tenant creates one time series per ticket, forever, in a metric that
 * looks perfectly ordinary.
 *
 * Express fills `req.route.path` with the template (`/tickets/:id`) once a
 * handler has matched, which is why this reads it in `tap` — after the handler
 * — rather than from the incoming URL.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsRegistry) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const started = process.hrtime.bigint();

    const record = () => {
      const response = http.getResponse<Response>();
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const labels = {
        route: this.routeTemplate(request),
        method: request.method,
        status: String(response.statusCode),
      };

      this.metrics.httpRequests.inc(labels);
      this.metrics.httpDuration.observe(labels, seconds);
    };

    return next.handle().pipe(
      tap({
        next: record,
        // Errors are recorded too, and this is where the R in RED comes from —
        // a metric that only counts successes cannot show an error rate, which
        // is the number anyone actually alerts on.
        error: record,
      }),
    );
  }

  /**
   * The template, with a bounded fallback.
   *
   * A request that matched no route (a 404) has no `req.route`, and using its
   * URL there would be strictly worse than anywhere else: a scanner probing
   * random paths would mint a new time series per probe. `unmatched` is one
   * series for all of them.
   */
  private routeTemplate(request: Request): string {
    const template = (request.route as { path?: string } | undefined)?.path;
    if (!template) return 'unmatched';

    // `baseUrl` carries the global prefix, so the label reads
    // `/api/v1/tickets/:id` rather than a bare `/tickets/:id` that would
    // collide across versions.
    return `${request.baseUrl ?? ''}${template}`;
  }
}
