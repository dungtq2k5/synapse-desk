"""Hybrid retrieval, end to end — 13-doc §2.2-2.3.

    tenant_scope(ctx)  ──┬──> Qdrant ANN      ──┐
                         └──> Postgres FTS    ──┴──> RRF ──> rerank ──> chunks

The one function feeding two arms is the security boundary (11-doc §1.4); the
rest of this module is the ranking and hydration around it.

**At the AI cap this degrades rather than failing.** The lexical arm needs no
embedding and therefore costs nothing, so a capped tenant gets results plus a
`LEXICAL_ONLY` marker instead of a 402 — corpus diagnostics survive at exactly
the moment someone is trying to work out what happened (RDM §1.14). The
degraded path still goes through `tenant_scope()`: the failure to avoid is a
fallback that skips the boundary because it is "just keyword search".
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime

import asyncpg
from qdrant_client import AsyncQdrantClient

from rag_service.common.caller_context import CallerContext
from rag_service.embeddings import EmbeddingClient
from rag_service.enums import AiGenerationPurpose
from rag_service.ledger.client import GenerationEntry, LedgerClient
from rag_service.ledger.quota import QuotaCounter
from rag_service.retrieval.arms import RetrievedChunk, lexical_arm, semantic_arm
from rag_service.retrieval.fusion import FusedChunk, reciprocal_rank_fusion
from rag_service.retrieval.rerank import Reranker, apply_rerank
from rag_service.retrieval.tenant_scope import TenantScope, tenant_scope
from rag_service.settings import AiSettings

logger = logging.getLogger(__name__)

SEMANTIC = "semantic"
LEXICAL = "lexical"

#: The starting `hnsw_ef`, and the value it is raised to on an under-return.
#:
#: **"Fewer than k" is not "nothing relevant."** A narrow-department user
#: legitimately matches few points, and HNSW can under-return even when more
#: exist. Misreading that turns every question from a small department into a
#: false escalation, which is the most user-visible way this pipeline fails.
HNSW_EF_DEFAULT = 128
HNSW_EF_RELAXED = 512


@dataclass(frozen=True)
class HydratedChunk:
    """A result with everything a citation needs, ready to render."""

    chunk_id: str
    document_id: str
    document_title: str
    page_number: int | None
    chunk_index: int
    content_text: str
    score: float
    vector_point_id: str


@dataclass(frozen=True)
class RetrievalResult:
    chunks: list[HydratedChunk]
    #: True when the semantic arm was skipped because the tenant is at the cap.
    lexical_only: bool
    #: Every chunk the retriever SAW, for the ledger. Empty is the
    #: knowledge-gap signal (11-doc §1.6), which is why it is recorded
    #: separately from what a generator eventually cites.
    retrieved_chunk_ids: list[str]


class RetrievalService:
    def __init__(
        self,
        qdrant: AsyncQdrantClient,
        pool: asyncpg.Pool,
        embeddings: EmbeddingClient,
        reranker: Reranker,
        quota: QuotaCounter,
        ledger: LedgerClient,
    ) -> None:
        self._qdrant = qdrant
        self._pool = pool
        self._embeddings = embeddings
        self._reranker = reranker
        self._quota = quota
        self._ledger = ledger

    async def retrieve(
        self,
        query: str,
        ctx: CallerContext,
        settings: AiSettings,
        *,
        budget: BudgetState,
        limit: int | None = None,
        skip_rerank: bool = False,
    ) -> RetrievalResult:
        """Both arms, fused, reranked, hydrated.

        `budget` is passed IN rather than read here, because the caller already
        had to know: a chat turn checks the budget before greeting
        classification, long before retrieval, and re-reading it would be a
        second Redis round trip answering a question already answered.
        """
        scope = tenant_scope(ctx)
        final_k = limit or settings.final_context_k

        # Both arms CONCURRENTLY. The sequential version reads better and
        # doubles the latency of every question for no benefit — the two arms
        # share nothing but the scope they were both handed.
        lexical = lexical_arm(self._pool, scope, query, limit=settings.top_n)

        arm_results: dict[str, list[RetrievedChunk]] = {}

        if budget.allows_embedding:
            semantic, arm_results[LEXICAL] = await asyncio.gather(
                self._semantic(query, scope, ctx, settings, settings.top_n, budget),
                lexical,
            )
            arm_results[SEMANTIC] = semantic
        else:
            # The DEGRADED path, and it still goes through `tenant_scope()`.
            # The failure to avoid is a fallback that skips the boundary
            # because it is "just keyword search" (13-doc §2.3 test 4).
            arm_results[LEXICAL] = await lexical

        fused = reciprocal_rank_fusion(
            arm_results,
            {
                SEMANTIC: settings.semantic_weight,
                LEXICAL: settings.lexical_weight,
            },
        )

        # HYDRATE, THEN RERANK — the order matters and the reverse does not
        # work. A cross-encoder scores (query, passage TEXT) pairs, and the text
        # lives in Postgres, not in Qdrant's payload or the FTS projection. The
        # pipeline used to rerank first, over candidates carrying only ids and a
        # score, so the one real reranker raised `AttributeError` on every call
        # — invisible to the suite, which substitutes a fake everywhere.
        #
        # The cost is real and inherent: the text is fetched for the whole fused
        # pool (`top_n`) rather than only the survivors (`final_context_k`).
        # There is no cheaper arrangement — ranking a candidate requires reading
        # it, so every candidate's text has to be in hand before the ranking,
        # whichever component does the fetching.
        hydrated = await self._hydrate(fused)

        chunks = (
            hydrated[:final_k]
            if skip_rerank
            else apply_rerank(self._reranker, query, hydrated, final_k)
        )

        return RetrievalResult(
            chunks=chunks,
            lexical_only=not budget.allows_embedding,
            # Recorded from the FUSED pool rather than the final selection: what
            # the retriever saw is a different question from what survived
            # rerank, and `UNCITED` needs both to mean anything (12-doc §4.2).
            retrieved_chunk_ids=[entry.chunk.chunk_id for entry in fused],
        )

    async def _semantic(
        self,
        query: str,
        scope: TenantScope,
        ctx: CallerContext,
        settings: AiSettings,
        top_n: int,
        budget: BudgetState,
    ) -> list[RetrievedChunk]:
        """Embed the query, search, and RELAX rather than concluding nothing."""
        started_at = time.monotonic()
        embedding = await self._embeddings.embed_query(query, settings.embedding_model)
        latency_ms = int((time.monotonic() - started_at) * 1000)

        # CHARGE first and await it — the only thing standing between a burst of
        # concurrent requests and all of them passing a stale gate.
        await self._quota.charge(
            budget.organization_id,
            budget.cycle_start,
            budget.cost_micros(settings.embedding_model, embedding.prompt_tokens, 0),
        )

        # RECORD second, fire-and-forget and shielded. The embedding already
        # happened and already cost money.
        self._ledger.record(
            GenerationEntry(
                organization_id=budget.organization_id,
                user_id=ctx.sub,
                purpose=AiGenerationPurpose.EMBEDDING,
                model_name=settings.embedding_model,
                prompt_tokens=embedding.prompt_tokens,
                latency_ms=latency_ms,
            )
        )

        results = await semantic_arm(
            self._qdrant, scope, embedding.vector, limit=top_n, hnsw_ef=HNSW_EF_DEFAULT
        )

        if len(results) < top_n:
            # NOT "nothing relevant". Retry with a wider search before anyone
            # downstream concludes DOC_MISSING — see HNSW_EF_RELAXED.
            logger.debug(
                "Semantic arm under-returned (%d of %d); relaxing hnsw_ef",
                len(results),
                top_n,
            )
            relaxed = await semantic_arm(
                self._qdrant,
                scope,
                embedding.vector,
                limit=top_n,
                hnsw_ef=HNSW_EF_RELAXED,
            )
            if len(relaxed) > len(results):
                return relaxed

        return results

    async def _hydrate(self, selected: list[FusedChunk]) -> list[HydratedChunk]:
        """Fetches the citation payload from Postgres in ONE query.

        Qdrant carries only what the filter needs; the title, page number and
        text live in `document_chunks` and `documents`. Fetching them per result
        would be N+1 on the hot path of every question.

        **Re-checks nothing.** These ids came through `tenant_scope()` on both
        arms; re-applying the boundary here would suggest the earlier
        application was not trusted, and a reviewer who believes there are two
        checks will eventually weaken one of them.
        """
        if not selected:
            return []

        by_chunk_id = {entry.chunk.chunk_id: entry for entry in selected}

        async with self._pool.acquire() as connection:
            rows = await connection.fetch(
                """
                SELECT
                    c.id::text              AS chunk_id,
                    c.document_id::text     AS document_id,
                    c.page_number           AS page_number,
                    c.chunk_index           AS chunk_index,
                    c.content_text          AS content_text,
                    c.vector_point_id::text AS vector_point_id,
                    d.title                 AS document_title
                FROM document_chunks c
                JOIN documents d ON d.id = c.document_id
                WHERE c.id = ANY($1::uuid[])
                """,
                list(by_chunk_id),
            )

        hydrated = [
            HydratedChunk(
                chunk_id=row["chunk_id"],
                document_id=row["document_id"],
                document_title=row["document_title"],
                page_number=row["page_number"],
                chunk_index=row["chunk_index"],
                content_text=row["content_text"],
                score=by_chunk_id[row["chunk_id"]].score,
                vector_point_id=row["vector_point_id"] or "",
            )
            for row in rows
        ]

        # Re-sorted into the incoming order. The SQL returns rows in whatever
        # order the planner chose, and `ANY($1)` gives no ordering guarantee, so
        # without this the FUSION ranking would be discarded here — and, when
        # rerank is skipped, `[:final_k]` would then keep an arbitrary subset.
        order = {entry.chunk.chunk_id: index for index, entry in enumerate(selected)}
        hydrated.sort(key=lambda chunk: order[chunk.chunk_id])

        return hydrated


@dataclass
class BudgetState:
    """What the caller already learned about this tenant's budget.

    Passed around rather than re-read, because the gate runs once per request —
    before greeting classification on a chat turn — and every later step needs
    the same answer. Re-reading would be a second Redis round trip for a
    question already answered, and worse, could answer it DIFFERENTLY mid-request.
    """

    organization_id: str
    cycle_start: datetime
    allows_embedding: bool

    def cost_micros(
        self, model_name: str, prompt_tokens: int, completion_tokens: int
    ) -> int:
        from rag_service.pricing import estimate_cost_micros

        return estimate_cost_micros(model_name, prompt_tokens, completion_tokens)
