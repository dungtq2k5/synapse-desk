import { createHash } from 'node:crypto';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { firstValueFrom, from, type Observable } from 'rxjs';
import {
  compareAlphabetically,
  type RequestContext,
} from '@synapsedesk/common';
import { RequestContextService } from '../contexts/request.context';
import { CacheService } from '../cache/cache.service';
import {
  CACHEABLE_KEY,
  type CacheableOptions,
} from '../decorators/cacheable.decorator';

/**
 * Serves `@Cacheable` reads from Redis.
 *
 * **Written rather than subclassed from `CacheInterceptor`.** `@nestjs/cache-manager`'s
 * default key is the request URL, which carries no tenant: `GET /roles` would
 * be one entry for every tenant on the platform. Overriding `trackBy` fixes
 * that and leaves `cache-manager` supplying a `get`/`set` wrapper over a Redis
 * client this gateway already has.
 *
 * **It caches the RESPONSE ENVELOPE, not the handler's return value**, because
 * it is registered as an `APP_INTERCEPTOR` and `TransformInterceptor` is bound
 * with `useGlobalInterceptors` — so this one sits OUTSIDE it and its
 * `next.handle()` yields the already-wrapped
 * `{ success, statusCode, message, warning, data }`.
 *
 * This docblock said the opposite until a test read an entry back and found an
 * envelope. The claim mattered: a GraphQL loader was built to share one of
 * these keys on the strength of it, and would have handed an envelope to a list
 * field. **Anything reading a `@Cacheable` key from outside the HTTP path must
 * expect the envelope, or use a scope of its own** — see
 * `CACHE_SCOPES.permissionsGraphql`.
 *
 * One consequence to know: `statusCode`, `message` and `warning` are frozen
 * into the entry, so an advisory attached to the MISS is replayed to every hit
 * for the rest of the TTL.
 */
@Injectable()
export class CacheableInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<
      CacheableOptions | undefined
    >(CACHEABLE_KEY, [context.getHandler(), context.getClass()]);

    if (!options) return next.handle();

    // GraphQL and WebSocket contexts have no `Request` — `switchToHttp()`
    // returns an EMPTY OBJECT under GraphQL rather than throwing, which is how
    // five guards in this gateway silently stopped working. A global
    // interceptor must check, not assume.
    const request = context.switchToHttp().getRequest<Request | undefined>();

    if (request?.method !== 'GET') return next.handle();

    const caller = RequestContextService.fromRequest(request);

    // No tenant, no tenant-first key. An unauthenticated read is not cached at
    // all rather than being cached under a shared segment.
    if (!caller?.organizationId) return next.handle();

    return from(
      this.cache.wrap(
        {
          organizationId: caller.organizationId,
          scope: options.scope,
          params: {
            ...(request.params as Record<string, unknown>),
            ...(request.query as Record<string, unknown>),
            // Present only when the read is caller-filtered, so a tenant-wide
            // entry stays one entry.
            ...(options.varyBy === 'caller'
              ? { __visibility: visibilityDigest(caller) }
              : {}),
          },
        },
        options.ttlSeconds,
        () => firstValueFrom(next.handle() as Observable<unknown>),
      ),
    );
  }
}

/**
 * A stable digest of what the caller is allowed to SEE.
 *
 * Keys on the department set, not on `sub`: two agents in the same departments
 * share one entry, which is the granularity `visibilityScope` filters at.
 * Sorted before hashing because a department list is a SET, and hashed so a user
 * in fifty departments does not produce a two-kilobyte key. Truncation is safe —
 * the tenant segment is the boundary, so a collision can only merge two
 * department sets within one tenant.
 *
 * **This must mirror `DocumentsService.visibilityScope` in ingestion-service.**
 * They are a pair: this decides who SHARES an answer, that decides what the
 * answer CONTAINS. They drift by someone widening the filter and not the digest,
 * and the symptom is a cached answer shown to a caller the filter would have
 * narrowed.
 *
 * **If a permission ever affects a cached read's result set, add it here.**
 * None does today; a `document.read.all`-style grant would change that, and
 * today's digest would serve the broader view to the narrower caller.
 */
function visibilityDigest(caller: RequestContext): string {
  const material = caller.isSuperAdmin
    ? 'super-admin'
    : [...caller.departmentIds].sort(compareAlphabetically).join(',');

  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}
