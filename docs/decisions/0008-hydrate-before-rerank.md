# 0008 — Hydrate the candidate pool before reranking

**Status:** accepted · **Code:** `apps/rag-service/`

## Decision

The fused pool is ids and scores. `content_text` lives in Postgres — in neither the Qdrant payload nor the FTS projection — so the pool is hydrated **before** rerank, for `top_n` rather than for the `final_context_k` survivors.

## Why

- **A cross-encoder scores `(query, passage text)` pairs.** It cannot rank text it has not fetched. Reranking first and fetching after the threshold check raised `AttributeError` on every real call — invisible to a suite that substitutes a fake everywhere.
- **The cost is inherent, not a regression.** Ranking a candidate requires the candidate.

## Consequences

- Multi-tenancy forced the split of *candidate ids* from *hydrated text*; that split is correct and the ordering must accommodate it, not the reverse.
- The two retrieval arms need a common fusion key: the FTS query selects `vector_point_id` so dedup and fusion are a straight join rather than a second lookup.
