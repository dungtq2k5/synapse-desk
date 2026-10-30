# 0052 — A conflict flag never names a document its readers can't open

**Status:** accepted · **Code:** `services/ingestion-service/src/modules/ingestion/conflict-check.service.ts` (`mayName`), `services/rag-service/rag_service/server.py` (`JudgeConflict`)

## Decision

**A `CONFLICTING` flag on document A naming document B exists only while every reader of A can open B:** B is organization-wide, or A isn't and B's departments include all of A's. Each direction is decided on its own, so a conflict between the organization-wide handbook and HR's leave policy is raised on HR's policy (its readers can open both) and not on the handbook.

**The rule is re-tested on every visibility change of either document, a delete included,** in the scope fan-out job. Every `CONFLICTING` flag on or naming it that no longer passes, open or already resolved, has its `detail` replaced by "The other document is no longer visible to this document's readers." and its related document, passage and confidence cleared; an open one is also resolved by the system, and a person's resolution keeps its resolution, actor and comment. A resolved flag is still readable ("include resolved"), so it must lose the other document's words too.

**Conflicts are judged, not detected by similarity alone.** Nearest passages of other documents above `CONFLICT_SIMILARITY_MIN` are candidates; rag-service's judge decides each pair on the tenant's AI allowance (`DOCUMENT_CONFLICT_CHECK`, deferred at the cap), and a verdict at `CONFLICT_CONFIDENCE_MIN` or more raises the flag.

## Why

- **A flag's `detail` quotes the other document,** and the card links to it. A flag visible to A's readers is a disclosure of B to them, exactly the department boundary retrieval keeps ([ADR 0036](./0036-scope-fanout-order-is-asymmetric.md)).
- **Lost alternative: pair only documents with identical scope.** The case worth catching, an organization-wide document against a department's own, would never be checked.
- **Lost alternative: hide the related document per viewer at read time.** The `detail` is prose naming both sides; nothing at read time could take B's words out of it.
- **Lost alternative: re-test nightly.** It leaves a narrowed document's words readable by the wrong people for up to a day.
- **Similarity can't tell agreement from contradiction:** passages making the same claim, agreeing or not, measured 0.91–0.95; unrelated cross-document passages topped out at 0.77. The threshold picks what is worth judging; the judge decides.

## Consequences

- **A document holds one open `CONFLICTING` flag per other document;** `(document, type, related document)` is the flag's key, and the most confident pair is kept.
- **A completed check recomputes the document's whole set,** and resolves every flag on it or naming it whose pair it no longer confirms; a check stopped at the cap or by a failure changes nothing and leaves the document unchecked (`conflicts_checked_at` null) for the nightly sweep.
- **The judge reads both passages as untrusted sources** behind the nonce boundary; it has no caller question for the injection screen, and is listed as an unguarded RPC with that reason. Its sentence is scrubbed and capped at 300 characters.
- **The spend is the threshold's:** if conflict checks show up on the AI usage page, `CONFLICT_SIMILARITY_MIN` is the knob.
