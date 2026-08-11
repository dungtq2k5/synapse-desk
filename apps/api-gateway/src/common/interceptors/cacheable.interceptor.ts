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
 * Serves `@Cacheable` reads from Redis — 29-doc §3.
 *
 * **Written rather than subclassed from `CacheInterceptor`.** `@nestjs/cache-manager`'s
 * default key is the request URL, which carries no tenant: `GET /roles` would
 * be one entry for every tenant on the platform. Overriding `trackBy` fixes
 * that and leaves `cache-manager` supplying a `get`/`set` wrapper over a Redis
 * client this gateway already has — 29-doc §1's reasoning, and the same
 * conclusion from the other direction.
 *
 * **It caches the handler's RETURN VALUE, not the HTTP response.** So the
 * envelope, the status code and any `warning` are produced fresh by
 * `TransformInterceptor` on every request, hit or miss — a cached envelope
 * would freeze whichever advisory happened to be attached to the miss.
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
    // five guards in this gateway silently stopped working (25-doc). A global
    // interceptor must check, not assume.
    const request: Request | undefined = context.switchToHttp().getRequest();

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
 * **Visibility, not identity.** Keying on `sub` would give every user their own
 * entry and collapse the hit rate to nothing; keying on the department set
 * means two agents in the same departments share one, which is exactly the
 * granularity `visibilityScope` filters at in ingestion-service.
 *
 * Sorted before hashing, because a department list is a SET — an id order that
 * varies between tokens would split one audience into several entries.
 *
 * Hashed rather than inlined so a user in fifty departments does not produce a
 * two-kilobyte Redis key. Truncated because this is a cache discriminator, not
 * a security boundary — the tenant segment is the boundary, and a collision
 * here can only merge two department sets WITHIN one tenant.
 *
 * **No freshness problem beyond the one that already exists:** `departmentIds`
 * comes from the caller's JWT, and the uncached path filters on the same claim.
 * A user removed from a department keeps their old view until the token
 * refreshes either way.
 *
 * ---
 *
 * **This must mirror `DocumentsService.visibilityScope` in ingestion-service**,
 * which is the only other place caller visibility is computed.
 * The two are a pair and only one of them looks like it is about security: this
 * one decides who SHARES an answer, that one decides what the answer CONTAINS.
 * They drift by someone widening the filter and not the digest, and the symptom
 * is a cached answer shown to a caller the filter would have narrowed.
 *
 * **If a permission ever affects a cached read's result set, it belongs here
 * too.** Today none does — `roles`, `departments`, `organizations` and
 * `permissions` are tenant-wide, and `/departments`'s one permission-dependent
 * parameter is enforced by `QueryPermissionGuard` before this interceptor runs
 * rather than by narrowing rows. A `document.read.all`-style grant would change
 * that, and today's digest would serve the broader view to the narrower caller.
 */
function visibilityDigest(caller: RequestContext): string {
  const material = caller.isSuperAdmin
    ? 'super-admin'
    : [...caller.departmentIds].sort(compareAlphabetically).join(',');

  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}
