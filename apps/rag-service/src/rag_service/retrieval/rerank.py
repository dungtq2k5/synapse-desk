"""The cross-encoder pass — `reranking.md`, adapted.

Fusion ranks by position; a cross-encoder actually READS the query and the
passage together and scores the pair. That is strictly better and strictly more
expensive, which is why it runs last, over a small candidate pool, rather than
over the corpus.

**Local and CPU-bound, deliberately.** An API reranker is spend on the hot path
of every question — metered, rate-limited and one more service that can be down
— to improve an ordering that fusion already got roughly right. FlashRank runs
in-process on the CPU.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    # Type-checking only, and it has to be: `service` imports THIS module for
    # `apply_rerank`, so a runtime import here is a cycle. `from __future__
    # import annotations` above makes every annotation lazy, and nothing below
    # touches the class at runtime — `dataclasses.replace` works off the
    # instance.
    from rag_service.retrieval.service import HydratedChunk

logger = logging.getLogger(__name__)


class Reranker(Protocol):
    """The capability, as a protocol so tests can substitute it.

    A substitute must honour the contract completely: return the SAME chunks,
    reordered, never a subset. A reranker that dropped candidates would silently
    change what "nothing above threshold" means, and that phrase is the
    difference between an answer and an escalation.

    Takes HYDRATED chunks, because a cross-encoder scores the query against the
    passage TEXT — which is the whole difference between it and fusion. It
    previously took `FusedChunk`, whose `.chunk` is an `arms.RetrievedChunk`
    carrying ids and a score and no text at all, so the one real implementation
    raised `AttributeError` on every call. Nothing caught it: every test
    substitutes a fake, and the only `FlashRankReranker()` in the tree is the
    production wiring in `server.py`.
    """

    def rerank(
        self, query: str, candidates: list[HydratedChunk]
    ) -> list[HydratedChunk]: ...


class FlashRankReranker:
    """FlashRank, loaded lazily.

    Lazily because the model is tens of megabytes read from disk, and importing
    it at module load makes every process that merely IMPORTS this module — the
    test collector, a migration, a shell — pay for a model it will not use.
    """

    def __init__(self) -> None:
        self._ranker = None

    def rerank(
        self, query: str, candidates: list[HydratedChunk]
    ) -> list[HydratedChunk]:
        if not candidates:
            return []

        try:
            ranker = self._load()
        except Exception as error:
            # Deliberately broad and deliberately non-fatal. A reranker that
            # cannot load is a QUALITY regression, not an outage: the fused
            # order is already a reasonable answer. Failing the request instead
            # would turn a missing model file into every user's search being
            # down.
            logger.warning("Reranker unavailable; falling back to fused order: %s", error)
            return candidates

        from flashrank import RerankRequest

        passages = [
            {"id": index, "text": entry.content_text}
            for index, entry in enumerate(candidates)
        ]
        ranked = ranker.rerank(RerankRequest(query=query, passages=passages))

        # Rebuilt from the ORIGINAL list by index, so the reranker cannot
        # introduce a chunk that was not a candidate, and the returned objects
        # keep every field it never saw.
        return [
            replace(candidates[int(result["id"])], score=float(result["score"]))
            for result in ranked
        ]

    def _load(self):
        if self._ranker is None:
            from flashrank import Ranker

            self._ranker = Ranker()

        return self._ranker


def apply_rerank(
    reranker: Reranker,
    query: str,
    candidates: list[HydratedChunk],
    final_context_k: int,
) -> list[HydratedChunk]:
    """Reranks, or SKIPS when the pool is already smaller than what is wanted.

    Per `reranking.md`: reordering five candidates when five are being kept
    changes nothing about which chunks reach the prompt, so the cross-encoder
    pass is pure cost. The skip is not an optimisation detail — for a
    narrow-department user, whose pool is legitimately small, it is the common
    case rather than the edge one.
    """
    if len(candidates) <= final_context_k:
        return candidates

    return reranker.rerank(query, candidates)[:final_context_k]
