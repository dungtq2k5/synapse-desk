# 0048 — A cached answer carries its scope's generation, so one produced before an invalidation is never read

**Status:** accepted · **Code:** `services/api-gateway/src/common/cache/cache.service.ts`, `services/api-gateway/src/main/java/com/synapsedesk/gateway/common/cache/CacheService.java` · **Supersedes:** [0034](./0034-read-repopulate-race-is-accepted.md)

## Decision

Every tenant and scope has a **generation**, a counter in Redis (`cache-gen:`). A read takes the generations **before** it produces its answer and stores the answer under a key that carries them. **Invalidating a scope increments its generation and still deletes the scope's keys.**

- **Scopes nest** (`entity`, `entity:user`, `entity:user:{id}`), so a key carries the generation of **each prefix** of its scope, read in one `MGET`. Invalidating a scope increments that level only, so an ancestor's invalidation reaches its children and a child's leaves its siblings alone.
- **The organization-status cache** (`org-status:{id}`) has one level per organization and works the same way.
- **Both gateways** use the same keys and counters.
- **Fail open:** generations that can't be read mean no cache for that read, never a stale answer.

## Why

0034 accepted a race: a read that produced its answer before an invalidation and stored it after put the old answer back for the whole TTL. It was judged a narrow window. CI showed it isn't narrow when the change happens **outside** the gateway: an upload's status is changed by ingestion-service and announced by an event, and a list read in flight across that event kept "Processing" on screen for 30 seconds after the document had failed. The same shape on the status cache would let a **frozen organization keep working** until its entry expired.

- **The generation closes it without a lock:** an answer from before the increment lands under a key no read asks for again, and expires on its own TTL.
- **Deleting as well** frees the memory at once, and is what an instance still on the old code understands during a rolling deploy.
- **Lost alternatives:** a distributed lock (0034's reason still holds: an outage path in a component whose contract is failing open); double-delete (narrows the window, doesn't close it).

## Consequences

- **One more Redis round trip per cached read** (the generations' `MGET` before the key's `GET`); a batch read is one `MGET` of generations before the `MGET` of keys.
- **Old entries wait out their TTL** under keys nothing reads; the delete removes most of them at once.
- `produce()` throwing is still never cached (0034's rule, kept).
- Related: [0012](./0012-cache-keys-are-tenant-first.md).
