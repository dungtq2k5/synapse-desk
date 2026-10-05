# 0033 — One Redis instance, and `noeviction`

**Status:** accepted · **Code:** `docker-compose.yml`, `apps/api-gateway/src/main/java/com/synapsedesk/gateway/realtime/RealtimeServerConfig.java` (the second client)

## Decision

`maxmemory-policy noeviction`. When the instance fills, **every** write fails — not just the cache's.

## Why

**Every eviction policy is worse**, each for a different reason:

- **`volatile-ttl` was tried and is wrong.** It evicts by nearest expiry, and the shortest expiry in the instance is **BullMQ's job lock** (`PX 30000`), not a cache entry. An evicted lock is not a cache miss — it is a job the stalled-checker returns to the queue and a second worker runs again. Every worker warns about it at boot.
- **`allkeys-lru` / `volatile-lru` are worse still.** The AI spend counter `quota:{org}:{cycle}` is cold by design — written once per generation, read once per gate check — so recency policies discard it and reset a tenant's metered spend mid-cycle.
- **On one shared instance no policy spares both.** Cache keys sit between the locks and the counter on every available ordering.

`noeviction` is the only setting that cannot silently corrupt something: a failed write is a visible error, a duplicated job is not.

## Consequences

- **This bounds nothing; it only makes the failure loud.** A second Redis instance for cache keys is the thorough fix and stays deferred — `maxmemory` is not per-database, so a separate logical DB would be a blast-radius boundary, not a limit.
- **Errors are logged, never thrown.** A cache read or write that fails falls through to the origin (`CacheService.wrap`), and the WebSocket rate limiter fails open (`WsThrottlerService`): a full instance degrades the gateway rather than stopping it.
- **Two clients, kept separate.** Spring Data Redis (Lettuce) serves everything except Socket.IO; Socket.IO's cross-replica store is a Redisson client of its own (`RealtimeServerConfig.java`), because that is the store netty-socketio speaks.
