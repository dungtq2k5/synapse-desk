import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { RequestContextService } from '../contexts/request.context';
import { entityScope, type EntityScopeKind } from '../config/cache.config';

export const INVALIDATE_CACHE_KEY = 'cache:invalidate';

/**
 * A scope to drop, or a function that derives one from the request.
 *
 * **It cannot name a tenant, and that is the type doing the work**
 * A target that builds its own key is a target that can omit the tenant,
 * and an invalidation missing its tenant segment either clears nothing or
 * reaches for a pattern that touches everyone. The tenant comes from the
 * request context, in one place, where it cannot be forgotten.
 */
export type CacheInvalidationTarget =
  string | ((context: ExecutionContext) => string | string[]);

/**
 * Drops cache scopes after this handler succeeds.
 *
 * ```ts
 * ＠Patch(':id')
 * ＠InvalidateCache(CACHE_SCOPES.departments)
 * update(...) { … }
 *
 * ＠Patch('me')
 * ＠InvalidateCache(CACHE_SCOPES.users, (ctx) => `entity:user:${callerOf(ctx)}`)
 * updateOwnProfile(...) { … }
 * ```
 *
 * **It runs AFTER the handler, and only if it SUCCEEDED.** Invalidating before
 * the write lets a concurrent read repopulate with the pre-write value, which
 * then survives its full TTL — strictly worse than not invalidating. Dropping
 * the scope after a failed handler turns every rejected request into a stampede
 * against an origin that just rejected something.
 *
 * **Scopes, not keys.** A mutation knows which scope it changed but cannot
 * enumerate cached keys, because a list read's key carries the caller's filters
 * and page — so dropping the parameterless entry alone would leave
 * `?page=2&status=OPEN` stale.
 */
export const InvalidateCache = (...targets: CacheInvalidationTarget[]) =>
  SetMetadata(INVALIDATE_CACHE_KEY, targets);

// `@InvalidateCache` targets for the entity cache.
//
// **An entity cache with no eviction is a staleness bug with a hit rate**, and
// these are the eviction. There is no `user.*` NATS contract and there should
// not be — every writer of a `UserSummary`'s fields is a gateway mutation, so a
// decorator here is PRECISE invalidation rather than a fallback.
//
// Two shapes, because the id arrives two ways:
//
//   - `PATCH /users/:id` names it in the route.
//   - `PATCH /users/me` and the avatar routes mean the CALLER, whose id is only
//     in the verified token.
//
// Getting that wrong is silent in the direction that matters: a target reading
// `params.id` on `/users/me` resolves to `undefined`, evicts
// `entity:user:undefined`, and leaves the real entry serving the old name for
// its whole TTL — with the request returning 200 and the eviction "running".

/** The entity named by a route parameter — `PATCH /departments/:id`. */
export const entityFromParam =
  (kind: EntityScopeKind, param = 'id'): CacheInvalidationTarget =>
  (context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    const id = (request.params as Record<string, string | undefined>)[param];

    // No id, no target. Returning `entity:{kind}:undefined` would evict a key
    // nothing ever wrote and report success.
    return id ? [entityScope(kind, id)] : [];
  };

/** The entity that IS the caller — `PATCH /users/me`, the avatar routes. */
export const entityFromCaller =
  (kind: EntityScopeKind): CacheInvalidationTarget =>
  (context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    const sub = RequestContextService.fromRequest(request)?.sub;

    return sub ? [entityScope(kind, sub)] : [];
  };
