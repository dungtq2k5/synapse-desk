"""Reciprocal Rank Fusion — 11-doc §1.5, with both of its corrections.

RRF combines two ranked lists without needing their scores to be comparable,
which matters because they are not: a cosine similarity and a `ts_rank` share no
scale, and any attempt to normalise them into one is a fudge factor nobody can
justify. RRF only reads POSITIONS, so the question "how do I weigh 0.83 against
0.0021" never arises.

Two things here were wrong in an earlier draft and each has a failure behind it.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from rag_service.retrieval.arms import RetrievedChunk

#: The RRF constant, from the original paper.
#:
#: It damps the difference between the top ranks: without it, rank 1 would be
#: worth infinitely more than rank 2, and a single arm's top hit would win every
#: fusion regardless of what the other arm thought. 60 is the published default
#: and there is no eval set here to justify moving it (11-doc §1.7).
RRF_K = 60


@dataclass(frozen=True)
class FusedChunk:
    """A candidate with its fused score and the arms that found it."""

    chunk: RetrievedChunk
    score: float
    #: Which arms contributed. Diagnostic rather than decorative — "found by
    #: lexical only" is exactly what an exact-phrase query should look like.
    arms: tuple[str, ...]


def reciprocal_rank_fusion(
    arm_results: dict[str, list[RetrievedChunk]],
    weights: dict[str, float],
) -> list[FusedChunk]:
    """Fuses per-arm rankings on `vector_point_id`.

    **Fused on `vector_point_id`, the COMMON KEY.** Qdrant returns it natively
    as the point id and the FTS query SELECTs it explicitly, so this is a
    straight join rather than a second lookup per candidate — which is the whole
    reason the lexical arm carries a column it never filters on.

    **Weights change ORDERING and never eligibility.** The correction 11-doc
    §1.5 makes: scaling `k` per arm (`k = top_n × w_semantic`) truncates an
    arm's contribution unpredictably, so a low-weighted arm can never surface
    its rank-8 result even when that result is the right one. Both arms are
    asked for the same k and the weighting happens HERE, where it can only
    reorder a candidate set that already contains everything both arms found.
    """
    scores: dict[str, float] = {}
    found: dict[str, list[str]] = {}
    chunks: dict[str, RetrievedChunk] = {}

    for arm, results in arm_results.items():
        weight = weights.get(arm, 1.0)

        for rank, chunk in enumerate(results, start=1):
            key = chunk.vector_point_id

            scores[key] = scores.get(key, 0.0) + weight / (RRF_K + rank)
            found.setdefault(key, []).append(arm)
            # First writer wins. The two arms return the same chunk with
            # different `score` fields — one a cosine similarity, one a
            # ts_rank — and neither belongs in the output, so which one is kept
            # is irrelevant as long as it is DETERMINISTIC. The fused score is
            # what the caller reads.
            chunks.setdefault(key, chunk)

    fused = [
        FusedChunk(
            chunk=replace(chunks[key], score=score),
            score=score,
            arms=tuple(found[key]),
        )
        for key, score in scores.items()
    ]

    # Sorted by score, then by key. The tiebreak is not cosmetic: two chunks at
    # identical rank in both arms have identical fused scores, and without a
    # deterministic tiebreak the order depends on dict iteration — so the same
    # query returns a different top-k between runs, and every ordering
    # assertion downstream is flaky for a reason nobody can reproduce.
    fused.sort(key=lambda entry: (-entry.score, entry.chunk.vector_point_id))

    return fused
