"""The cross-encoder pass, against the REAL FlashRank model.

Every other suite substitutes `RecordingReranker`, which is right for what those
suites assert — whether rerank *ran*, not how it ordered. But it meant nothing
in the tree ever constructed `FlashRankReranker` except the production wiring,
and the one thing a fake cannot check is whether the real implementation can
read its own input.

It could not: `rerank()` reached for `.content_text` on a chunk that carries
ids and a score and no text, so every reranked search raised `AttributeError` —
in production only, on the hot path of every question.

These tests are deliberately few and deliberately real. The model is ~3MB,
downloaded once and cached; a fake is exactly what hid the defect.

See docs/decisions/0008-hydrate-before-rerank.md.
"""

from __future__ import annotations

import pytest

from rag_service.retrieval.rerank import FlashRankReranker, apply_rerank
from rag_service.retrieval.service import HydratedChunk

CAFETERIA = "The office cafeteria serves lunch between noon and two."
LEAVE = "Unused annual leave carries over, up to five days, into the next year."
PARKING = "Parking permits are issued by the facilities team on request."


def chunk(index: int, text: str) -> HydratedChunk:
    return HydratedChunk(
        chunk_id=f"chunk-{index}",
        document_id="doc-1",
        document_title="Employee Handbook",
        page_number=index,
        chunk_index=index,
        content_text=text,
        # Descending, so a reranker that did nothing would leave CAFETERIA on
        # top — which is what makes the reordering assertion below meaningful.
        score=1.0 / index,
        vector_point_id=f"point-{index}",
    )


@pytest.fixture(scope="module")
def reranker() -> FlashRankReranker:
    return FlashRankReranker()


class TestTheRealReranker:
    def test_it_can_READ_its_candidates(self, reranker):
        """The regression. This raised `AttributeError` before the reorder.

        Asserting on the count rather than the order, because the failure being
        pinned is "the reranker cannot see the text at all" — which no amount of
        ordering assertion would distinguish from a merely mediocre model.
        """
        candidates = [chunk(1, CAFETERIA), chunk(2, LEAVE), chunk(3, PARKING)]

        ranked = reranker.rerank("how much annual leave carries over?", candidates)

        assert len(ranked) == len(candidates)

    def test_it_returns_the_SAME_chunks_never_a_subset(self, reranker):
        # The contract every substitute is also held to. A reranker that dropped
        # candidates would silently change what "nothing above threshold" means,
        # and that phrase is the difference between an answer and an escalation.
        candidates = [chunk(1, CAFETERIA), chunk(2, LEAVE), chunk(3, PARKING)]

        ranked = reranker.rerank("annual leave", candidates)

        assert sorted(c.chunk_id for c in ranked) == sorted(
            c.chunk_id for c in candidates
        )

    def test_it_actually_REORDERS_by_relevance(self, reranker):
        """The value the cross-encoder adds, and which was never once delivered.

        The fused order puts CAFETERIA first (highest incoming score). A model
        that reads the query alongside each passage puts the leave policy there.
        """
        candidates = [chunk(1, CAFETERIA), chunk(2, LEAVE), chunk(3, PARKING)]

        ranked = reranker.rerank("how many annual leave days carry over?", candidates)

        assert ranked[0].content_text == LEAVE

    def test_it_preserves_every_field_it_never_saw(self, reranker):
        # It is handed text and returns whole chunks, so the citation payload —
        # title, page, vector point id — has to survive the round trip. Losing
        # them here would break citations rather than ranking, which is the
        # harder failure to trace back.
        candidates = [chunk(1, CAFETERIA), chunk(2, LEAVE), chunk(3, PARKING)]

        ranked = reranker.rerank("annual leave", candidates)
        top = next(c for c in ranked if c.content_text == LEAVE)

        assert (top.chunk_id, top.document_title, top.page_number) == (
            "chunk-2",
            "Employee Handbook",
            2,
        )

    def test_an_EMPTY_candidate_list_is_not_a_model_call(self, reranker):
        assert reranker.rerank("anything", []) == []


class TestApplyRerank:
    def test_it_SKIPS_when_the_pool_is_no_bigger_than_what_is_kept(self, reranker):
        # Reordering three candidates when three are being kept
        # cannot change which chunks reach the prompt, so the cross-encoder pass
        # is pure cost — and for a narrow-department user, whose pool is
        # legitimately small, this is the common case rather than the edge one.
        candidates = [chunk(1, CAFETERIA), chunk(2, LEAVE), chunk(3, PARKING)]

        kept = apply_rerank(reranker, "annual leave", candidates, final_context_k=3)

        # Untouched, in the incoming order — proof the model was not consulted.
        assert [c.chunk_id for c in kept] == ["chunk-1", "chunk-2", "chunk-3"]

    def test_it_runs_and_TRUNCATES_when_the_pool_is_bigger(self, reranker):
        candidates = [chunk(1, CAFETERIA), chunk(2, LEAVE), chunk(3, PARKING)]

        kept = apply_rerank(reranker, "annual leave", candidates, final_context_k=1)

        assert len(kept) == 1
        assert kept[0].content_text == LEAVE
