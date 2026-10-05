# 0034 — The cache read-repopulate race is accepted, not fixed

**Status:** accepted · **Code:** `apps/api-gateway/src/main/java/com/synapsedesk/gateway/cache/CacheService.java` (`wrap`)

## Decision

```txt
reader:  get (miss) ── produce() ────────────── set(stale)
writer:                    └─ invalidate() ──┘
```

An invalidation landing between `produce()` and `set` is overwritten by the value already in flight, and that pre-write value then lives for its full TTL. This is accepted.

## Why

- **Every fix costs more than the bug.** Double-delete, versioned keys and a distributed lock each add a failure mode larger than the one they close — a lock adds an outage path to a component whose entire contract is failing open.
- **The worst case is one entry stale for one TTL.** The window is a single gRPC round trip, and a mutation has to land inside it.
- **On this gateway the window is wider than a round trip.** Nothing evicts at write time: the only eviction is `CacheInvalidationConsumer`, on the NATS event the owning service publishes, so a read that lands before that event is consumed repopulates the old value. Departments, roles and organizations have no such event at all, so for them the window is the cache's TTL ([known gap 60](../reference/known-gaps.md)).

## Consequences

- Worth writing down at the call site, because the symptom is indistinguishable from a real bug and costs a day otherwise.
- `produce()` throwing is never cached: caching a failure turns one bad response into a minute of them, exactly when the origin is already in trouble.
- Related: [0012](./0012-cache-keys-are-tenant-first.md), which records that response caching cannot be invalidated at all.
