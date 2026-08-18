# 0034 — The cache read-repopulate race is accepted, not fixed

**Status:** accepted · **Code:** `apps/api-gateway/src/common/cache/cache.service.ts` (`wrap`)

## Decision

```txt
reader:  get (miss) ── produce() ────────────── set(stale)
writer:                    └─ invalidate() ──┘
```

An invalidation landing between `produce()` and `set` is overwritten by the value already in flight, and that pre-write value then lives for its full TTL. This is accepted.

## Why

- **Every fix costs more than the bug.** Double-delete, versioned keys and a distributed lock each add a failure mode larger than the one they close — a lock adds an outage path to a component whose entire contract is failing open.
- **The worst case is one entry stale for one TTL.** The window is a single gRPC round trip, and a mutation has to land inside it.
- What keeps it a narrow window rather than the common case is that `CacheInvalidationInterceptor` evicts **after** the handler resolves (`concatMap`, asserted in `cache-invalidation.spec.ts`). Evicting before the write would make that interleaving the normal ordering rather than a race.

## Consequences

- Worth writing down at the call site, because the symptom is indistinguishable from a real bug and costs a day otherwise.
- `produce()` throwing is never cached: caching a failure turns one bad response into a minute of them, exactly when the origin is already in trouble.
- Related: [0012](./0012-cache-keys-are-tenant-first.md), which records that response caching cannot be invalidated at all.
