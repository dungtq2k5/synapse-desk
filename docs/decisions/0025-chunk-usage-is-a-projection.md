# 0025 — Chunk usage is a projection, not a query over the ledger

**Status:** accepted · **Code:** `apps/ingestion-service/`

## Decision

The `UNCITED` document flag is written by a daily projection job, not derived on demand from `ai_generations.retrieved_chunk_ids`.

## Why

- **It is not a pure query, and worse, it is temporary.** Retention rolls the ledger into daily per-(org, purpose, model) aggregates that **do not carry the chunk arrays**. Any query written against raw rows silently loses history the moment retention ships.

## Consequences

- Same trap as analytics rollups — see [0009](./0009-rollups-are-plain-tables.md).
- Ordering matters: the projection must run **before** the retention roll, not after.
