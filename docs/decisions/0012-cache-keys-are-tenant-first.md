# 0012 — Cache keys start with the tenant id, and not via `@nestjs/cache-manager`

**Status:** accepted · **Code:** `apps/api-gateway/src/common/cache/`

## Decision

The tenant id is the first segment of every cache key. The cache is built on the shape `AnalyticsCacheService` already proved, not on `CacheModule`.

## Why

- **`CacheInterceptor`'s default key is the request URL, which contains no tenant.** `GET /tickets` is one key for every tenant on the platform, so the second tenant to ask receives the first tenant's tickets. No error, no trace.
- **Parameters must be sorted.** `?from=A&to=B` and `?to=B&from=A` are the same query; two spellings halves the hit rate invisibly, and the severe version is a mutation invalidating one spelling and not the other.
- **Absent and empty collapse.** `undefined`, `null` and `''` are dropped rather than serialised, so "filter not supplied" is one entry.

## Consequences

- TTL is derived from the range, not one global value. Today's data changes constantly; last quarter's cannot change at all.
- The Redis module is **not** `@Global()` — consumers import it explicitly so the dependency stays visible in each module's `imports`.
- **Invalidation is built before the first cached read.** Turning caching on first means the window where staleness exists is the window before anyone has thought about it.
- **Response caching cannot be invalidated, and that is structural.** There is no way to enumerate cached responses mentioning ticket #1042 without a reverse index (a second cache with its own consistency problem) or a keyspace scan on every write. Staleness is accepted deliberately and bounded by TTL.
