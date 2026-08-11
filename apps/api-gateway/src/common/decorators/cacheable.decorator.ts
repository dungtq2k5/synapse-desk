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
 * four of the five reads 29-doc §3 lists and catastrophically wrong for the
 * fifth: `GET /documents` is filtered by `visibilityScope` — org-wide ∪ the
 * caller's departments — so one tenant-keyed entry would serve a Finance
 * agent's documents to Support. That is the 28-doc §2 failure one level down:
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
 * Caches this GET, tenant-first — 29-doc §3.
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
 * `GET /notifications/unread-count` is the one that looks obvious and is not —
 * it is the most-polled route in the product, and the WebSocket already pushes
 * `notification:unread-count` authoritatively (22-doc). The polling a cache
 * would optimise is polling that should stop.
 *
 * **It documents itself, in the same call** — 30-doc §5 step 3. The OpenAPI
 * operation gains an `x-cache` extension carrying exactly these values, so a
 * client can see which reads are cached and on what terms without anybody
 * maintaining a second list. A hand-written list of cached routes is a list
 * that is wrong the first time somebody changes a TTL.
 */
export const Cacheable = (options: CacheableOptions) =>
  applyDecorators(
    SetMetadata(CACHEABLE_KEY, options),
    // The SAME object the interceptor reads. Publishing a copy would let the
    // document and the behaviour disagree, which is worse than not publishing.
    ApiExtension('x-cache', options),
  );
