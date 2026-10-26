# Caching

What is cached in the gateway, how the keys are shaped, and what evicts them. An **axis**, not a flow — every flow touches this and none of them owns it.

The *decisions* are ADRs [0012](../decisions/0012-cache-keys-are-tenant-first.md), [0029](../decisions/0029-graphql-caches-entities-not-responses.md), [0033](../decisions/0033-redis-noeviction.md) and [0048](../decisions/0048-cache-entries-carry-their-scopes-generation.md) (which superseded 0034). This page is what is true today.

---

## The key

```text
<prefix>|<organizationId>|<scope>|<k=v&k=v sorted>|@<version>
```

**The tenant id is the first segment**, always — `NO_TENANT` where there is none. That is what makes a whole tenant evictable with one pattern, and what makes a cross-tenant read structurally impossible rather than merely unlikely.

Parameters are filtered (`undefined`, `null` and `''` dropped), then **sorted**, so `?a=1&b=2` and `?b=2&a=1` are one entry rather than two. The optional `@version` segment is a freshness discriminator — a rollup's `computedAt`, a document's revision — which turns "is this stale" into "is this a different key".

**`CacheService.get` is the only read path.** A hand-rolled `get`-then-`set` at a call site is where a key gets built a second, slightly different way; the two spellings then diverge and an invalidation clears only one of them. **`produce()` throwing is not cached.**

---

## Scopes

`CACHE_SCOPES` names every one, and the naming is the point: *"a scope is written in two places by nature — at the read that caches it and at the write that evicts it."* Two string literals is how a mutation invalidates `department` while the read caches `departments`, which nothing reports: the read simply never sees an eviction and serves its TTL out forever, correctly by its own lights.

| Scope | Evicted by |
| :--- | :--- |
| `departments`, and the four handlers that write a user's name or avatar | `@InvalidateCache` — **precise, and the whole story** |
| `roles`, `organizations`, the rest of `users` | `@InvalidateCache` where a decorated mutation writes them — but see §*Two writers evict nothing* |
| `tickets`, `documents` | NATS events from the owning service |
| `settings` | `BILLING_PATTERNS.entitlementsChanged` |
| `permissions`, `permissionsGraphql` | **nothing — TTL only** |

**`permissions` and `permissionsGraphql` are two scopes for one dataset, on purpose.** `CacheableInterceptor` runs outside `TransformInterceptor`, so `GET /permissions` stores the whole response envelope while a resolver stores the bare list. One key would mean whichever surface wrote first decides the shape and the other misreads it — GraphQL handing an envelope to a list field, or REST returning a bare array where a client expects the envelope. A second entry per tenant is the price.

Both are TTL-only because the catalogue is a function of the deploy as much as of the tenant, and the route accepts up to an hour of editors being offered a just-retired code — the API refuses the grant regardless ([ADR 0038](../decisions/0038-permissions-are-a-compile-time-artifact.md)).

---

## Entity caching, and the two granularities

GraphQL caches **behind the loaders, at entity granularity** — not whole responses ([ADR 0029](../decisions/0029-graphql-caches-entities-not-responses.md)).
Where response caching is used, the session key is `user:{sub}` from the verified token, **never the raw token**.

`entityScope(kind, id)` produces `entity:user:abc` rather than an `entity:user` scope with an `id` parameter, and that shape gives two eviction granularities
from one mechanism:

- `invalidateScope(org, entityScope('user', id))` drops exactly that user
- `invalidateScope(org, 'entity:user')` drops every cached user in the tenant

The precise form is what a mutation uses; the coarse one exists for the day something changes users in bulk.

**`ENTITY_TTL_SECONDS` is five minutes, and for two known paths it is the mechanism rather than the backstop.**

For `departments` and the four handlers writing a user's name or avatar, the decorator *is* precise invalidation, exactly as the interceptor's docblock says: *"Where it IS the whole story is a scope whose only writer is a gateway mutation."*

### Two writers evict nothing

`CacheInvalidationInterceptor` derives the tenant from request context and
returns early without one — `if (!caller?.organizationId) return;`. Two real
paths hit that branch:

| Path | Why it has no tenant |
| :--- | :--- |
| `POST /invitations/accept` | unauthenticated by design; it writes `roles.user_assigned` and carries no decorator |
| a platform Super Admin writing into a tenant | the caller belongs to no organization, so there is no scope to drop |

**So the five minutes is chosen against two enumerated paths, not a hypothetical one** — which is a stronger argument for the number than "the writer nobody has thought of". For those paths the TTL is the only thing that clears the entry.

---

## Cross-service invalidation

The gateway caches data three services own, so eviction arrives as events rather than as method calls — `CacheInvalidationConsumer.java` subscribes to every `TICKET_PATTERNS` subject, three `DOCUMENT_PATTERNS` (indexed, ingestionFailed, scopeChanged) and `BILLING_PATTERNS.entitlementsChanged`.

**These are core NATS, not durable.** A lost invalidation costs a stale entry until its TTL, which is the trade [ADR 0041](../decisions/0041-durable-subjects-are-the-ones-with-nothing-to-reconcile-against.md) draws: the cache can be reconstructed from the source of truth, so there is nothing to reconcile against.

---

## The read-repopulate race is closed by generations

```text
reader:  get (miss) ── produce() ────────────── set
writer:                    └─ invalidate() ──┘
```

A reader that missed, then produced, used to be able to write a value the writer's invalidation was meant to remove, and keep it for the whole TTL. [ADR 0048](../decisions/0048-cache-entries-carry-their-scopes-generation.md) closes it:

- **Every tenant and scope has a generation** (`cache-gen:` in Redis). A read takes the generations of its scope **and each prefix of it** (`entity`, `entity:user`, `entity:user:{id}`) in one `MGET` before `produce()`, and stores its answer under a key carrying them.
- **Invalidating a scope increments its generation and still deletes its keys.** An answer produced before the increment lands under the old key, which no read asks for again; the delete frees memory and is what an older instance understands mid-deploy.
- **The organization-status cache** (`org-status:{id}`) has one level per organization and works the same way, so a status read just before a freeze can't keep a frozen organization working.
- **Generations that can't be read mean no cache for that read,** never a stale answer.
- **The cost is one more Redis round trip per cached read** (the generations' `MGET`).

---

## Redis

One instance, `noeviction`, and three connections that stay separate ([ADR 0033](../decisions/0033-redis-noeviction.md)). `noeviction` is deliberate: this Redis holds BullMQ schedules, throttler counters and AI quota counters alongside the cache, and an eviction policy that discards a quota counter to make room for a cached department is a policy that silently stops metering.

The cache is therefore **not** the only tenant of this Redis, which is why `FLUSHALL` is a destructive operation on four subsystems rather than one — see `test:system`'s own warning.

---

## When it misbehaves

| Symptom | Look at |
| :--- | :--- |
| A mutation does not show up | the scope spelled at the read vs at the write — `CACHE_SCOPES` exists to make that one string |
| A role's `userAssigned` is stale after an invitation is accepted | expected for up to `ENTITY_TTL_SECONDS` — that route is unauthenticated, so the interceptor has no tenant and evicts nothing |
| A stale value outlives a mutation by minutes | the invalidation never arrived (the NATS consumer, below), or the generation wasn't incremented for that scope; a read in flight across the invalidation can't cause it any more |
| REST and GraphQL disagree about a shape | the two `permissions` scopes; they must not share a key |
| One tenant sees another's data | the key's first segment — this should be structurally impossible |
| Evictions stopped entirely | the NATS consumer, not the cache — these subjects are core, so a dropped one is silent |
| Redis is full | `noeviction` means writes fail rather than something being discarded; check what else is in there |
