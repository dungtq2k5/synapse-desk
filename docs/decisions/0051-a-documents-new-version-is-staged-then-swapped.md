# 0051 — A document's new version is built staged and swapped in; until then the live one answers

**Status:** accepted · **Code:** `services/ingestion-service/src/modules/ingestion/ingestion.processor.ts`, `services/ingestion-service/src/common/live-version.ts`, `services/rag-service/rag_service/retrieval/tenant_scope.py`

## Decision

**Every run that rebuilds a document's passages (a reindex, a replace, a retry) builds them beside the live version, invisible, and swaps them in at the end.** Chunk rows and their Qdrant points are written with `is_staged = true`; both retrieval arms and every list and count skip staged chunks. The swap deletes the document's live points and clears `is_staged` on the new ones in Qdrant, then does the same to its rows in one Postgres transaction. Each half works by filter on the document, so it is idempotent.

**A document with a live version stays `INDEXED`** through the run and after it fails or is cancelled. The run's state is the job's, and every document response carries its newest job as `latestJob`.

## Why

- **Deleting first left the document answering nothing,** from the purge to the last upsert, and then answering from part of the new version. A run deferred at the AI cap stayed half indexed until the allowance reset; one that failed on its last attempt stayed with whatever it had embedded.
- **Lost alternative: a generation number per document,** read at query time. The vector arm can't join to the document's current generation, so it would need the number copied into every point and updated on every swap: the same two writes as a flag, plus a lookup.
- **Lost alternative: reuse `is_deleted` to hide the new version.** A soft delete or restore rewrites `is_deleted` on every chunk of the document, and would publish a half-built version.
- **Qdrant before Postgres:** in the window between them, the vector arm returns new points whose rows (read by id) carry the new text while the lexical arm still returns the old: mixed, never empty. The other order leaves the vector arm's hits pointing at deleted rows.
- **`INDEXED` because it's true:** the document is answering. While its status went to `PROCESSING`, the help center hid the article for the whole update.

## Consequences

- **A run that stops before the swap changes nothing a reader sees.** A refusal, a cancellation and the last attempt purge the staged data; an earlier attempt and a deferral keep it, and the next run **reuses every staged chunk whose text is unchanged and already embedded** (one embedding model for every tenant, so identical text embeds identically). A reindex re-embeds everything: the live version is never reused.
- **The swap stamps the document's current scope** onto the new version, so a scope change during the run reaches it.
- **`PAGES_NOT_INDEXED` is raised or resolved at the swap,** so it describes the live version.
- **Deploy order for an upgrade:** rag-service's staged clause must be live before ingestion-service writes a staged chunk ([ADR 0044](./0044-expand-and-contract-never-in-one-release.md)).
- **A replace still deletes the old file at the confirm** (known gap 72): through an update, the original opens the new file while answers cite the previous version.
