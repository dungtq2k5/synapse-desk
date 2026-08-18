# 0033 — One Redis instance, `noeviction`, and three connections that stay separate

**Status:** accepted · **Code:** `apps/api-gateway/src/common/redis/redis.service.ts`, `docker-compose.yml`

## Decision

`maxmemory-policy noeviction`. When the instance fills, **every** write fails — not just the cache's.

## Why every eviction policy is worse

- **`volatile-ttl` was tried and is wrong.** It evicts by nearest expiry, and the shortest expiry in the instance is **BullMQ's job lock** (`PX 30000`), not a cache entry. An evicted lock is not a cache miss — it is a job the stalled-checker returns to the queue and a second worker runs again. Every worker warns about it at boot.
- **`allkeys-lru` / `volatile-lru` are worse still.** The AI spend counter `quota:{org}:{cycle}` is cold by design — written once per generation, read once per gate check — so recency policies discard it and reset a tenant's metered spend mid-cycle.
- **On one shared instance no policy spares both.** Cache keys sit between the locks and the counter on every available ordering.

`noeviction` is the only setting that cannot silently corrupt something: a failed write is a visible error, a duplicated job is not.

## Consequences

- **This bounds nothing; it only makes the failure loud.** A second Redis instance for cache keys is the thorough fix and stays deferred — `maxmemory` is not per-database, so a separate logical DB would be a blast-radius boundary, not a limit.
- **Errors are logged, never thrown.** Every consumer degrades: a cache falls through to its origin, presence reports nobody online, the org-status check fails open. An unhandled `error` event on an ioredis client is an unhandled rejection, which takes the process down — the listener is not decoration.
- **Three sites keep their own connection**, pinned by `redis-clients.spec.ts` so a fourth cannot appear quietly:
  - The **Socket.IO adapter** holds a pub/sub pair — a client in subscriber mode may issue no other commands, and `createAdapter` wants a matched pair with the adapter's lifetime.
  - The **throttler** is handed a URL, not an instance: `ThrottlerStorageRedisService` closes only the connection it built, so passing an instance leaks it past shutdown.
  - The **health probe** needs the opposite options — one attempt, a command timeout, `enableOfflineQueue: false`. Sharing this client would let the probe buffer its command through an outage and report UP the moment Redis returned, having reported nothing while it was down. A probe that cannot lie is the goal.
