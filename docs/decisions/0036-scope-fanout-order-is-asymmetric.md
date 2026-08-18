# 0036 — Scope fan-out order is asymmetric, and restrictions are synchronous

**Status:** accepted · **Code:** `apps/ingestion-service/src/modules/ingestion/scope-writer.service.ts`

## Decision

A visibility change is written to `document_chunks` and the Qdrant payload in an order that depends on the **direction** of the change:

- **Restrictions** (removing departments, `is_organization_wide: true → false`, delete) — Qdrant first, then `document_chunks`, then `documents`.
- **Grants** (adding departments, `false → true`, restore) — `documents` first.

Both retrievable stores are written **synchronously** on a restriction.

## Why

- **A partial failure must over-restrict, never over-expose.** Failing partway through a restriction makes the document vanish from retrieval while still appearing in lists: safe, visible, and fixed by a retry. Failing partway through a grant merely makes someone wait for access they were promised.
- **Reversing the order produces the failure that matters**: the document is IT-only in every list view and **still retrievable by everyone**. A user who just lost access keeps receiving it inside AI answers while every screen insists that is impossible — and nothing errors, so nothing reports it.
- **Async is not good enough for the restricting write.** An earlier version narrowed the chunk rows and left Qdrant to a queued job, so for as long as that job sat in the queue the semantic arm kept serving a document the API had just said was restricted. *"The endpoint returns once the restricting store is updated"* means both stores, because both are retrievable.

## Consequences

- The BullMQ job is the **reconciler**, not the writer: it re-applies the same scope with retries and backoff, so a partial failure converges without a human.
- Worth a real test rather than a read: inject a Qdrant failure mid-restriction and assert the document ends up over-restricted. That is the test that fails if someone later "simplifies" the order, and its absence is invisible until it is a disclosure.
