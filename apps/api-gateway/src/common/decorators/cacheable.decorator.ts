import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

export const CACHEABLE_KEY = 'cache:cacheable';

/**
 * What the answer depends on — and it has NO default, deliberately.
 *
 * `'tenant'` means every member of a tenant gets the same answer.
 * `'caller'` means the answer is filtered by who is asking, so the caller's
 * VISIBILITY joins the key.
 *
 * **Requiring it is the whole point.** A default of `'tenant'` is right for
 * four of the five cacheable reads and catastrophically wrong for the
 * fifth: `GET /documents` is filtered by `visibilityScope` — org-wide ∪ the
 * caller's departments — so one tenant-keyed entry would serve a Finance
 * agent's documents to Support. That is the tenant-key failure one level down:
 * the tenant segment is correct and the answer still belongs to somebody else.
 *
 * A field somebody must fill in is a question somebody must answer. A default
 * is a question nobody is asked.
 */
export type CacheVaryBy = 'tenant' | 'caller';

export type CacheableOptions = {
  /** From `CACHE_SCOPES` — the same constant the invalidating write names. */
  scope: string;
  ttlSeconds: number;
  varyBy: CacheVaryBy;
};

/**
 * Caches this GET, tenant-first.
 *
 * ```ts
 * ＠Get()
 * ＠Cacheable({ scope: CACHE_SCOPES.roles, ttlSeconds: 300, varyBy: 'tenant' })
 * list(...) { … }
 * ```
 *
 * **The list of what gets this is short on purpose.** A cache on a read that
 * changes constantly is a bug with a hit rate: tickets, messages and
 * notifications are excluded because a user watching their own ticket must not
 * watch their own reply disappear for a minute.
 *
 * `GET /notifications/unread-count` looks obvious and is not — it is the
 * most-polled route in the product, and the WebSocket already pushes
 * `notification:unread-count` authoritatively. The polling a cache would
 * optimize is polling that should stop.
 *
 * **It documents itself in the same call**: the OpenAPI operation gains an
 * `x-cache` extension carrying these values, so nobody maintains a second list
 * of cached routes — which would be wrong the first time a TTL changed.
 *
 * See `docs/decisions/0012-cache-keys-are-tenant-first.md`.
 */
export const Cacheable = (options: CacheableOptions) =>
  applyDecorators(
    SetMetadata(CACHEABLE_KEY, options),
    // The SAME object the interceptor reads. Publishing a copy would let the
    // document and the behaviour disagree, which is worse than not publishing.
    ApiExtension('x-cache', options),
  );
