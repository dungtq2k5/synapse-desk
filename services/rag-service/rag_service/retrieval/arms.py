"""The two retrieval arms, each callable ALONE.

Callable alone is not a convenience — it is what makes the isolation tests
meaningful. A test that queries hybrid and passes proves nothing about *which*
arm enforced the boundary: the vector arm could be filtering correctly while the
lexical arm leaks, and fusion would hide it because the leaked chunk simply
appears among correct ones.

So each arm is a function that takes a `TenantScope` and nothing else, and
neither builds a filter of its own.
"""

from __future__ import annotations

from dataclasses import dataclass

import asyncpg
from qdrant_client import AsyncQdrantClient

from rag_service.qdrant.collection import COLLECTION_NAME
from rag_service.retrieval.tenant_scope import TenantScope


@dataclass(frozen=True)
class RetrievedChunk:
    """A candidate from either arm.

    Keyed on `vector_point_id` — the COMMON FUSION KEY. Qdrant
    returns it natively as the point id; the FTS query selects it explicitly so
    dedup and fusion are a straight join rather than a second lookup.
    """

    vector_point_id: str
    chunk_id: str
    document_id: str
    score: float


async def semantic_arm(
    client: AsyncQdrantClient,
    scope: TenantScope,
    query_vector: list[float],
    limit: int,
    hnsw_ef: int = 128,
) -> list[RetrievedChunk]:
    """ANN search with the tenant filter applied INSIDE the query.

    Not post-filtering, which under-returns (you ask for k, the filter removes
    most of them, and you are left with three), and not naive pre-filtering,
    which kills ANN performance. Qdrant estimates filter cardinality and either
    traverses HNSW skipping non-matches or exact-scans the matching subset.

    `hnsw_ef` is raised above the default because a **restrictive filter can
    still under-return**: a user in one small department may match few points,
    and HNSW can return fewer than k even when more exist. That is why the
    caller must not read "fewer than k" as "nothing relevant" — doing so turns a
    narrow-department user's every question into a false escalation.
    """
    response = await client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        query_filter=scope.qdrant,
        limit=limit,
        search_params=qdrant_search_params(hnsw_ef),
        with_payload=True,
    )

    return [
        RetrievedChunk(
            vector_point_id=str(point.id),
            chunk_id=str((point.payload or {}).get("chunk_id", "")),
            document_id=str((point.payload or {}).get("document_id", "")),
            # No conversion, unlike its neighbours: `ScoredPoint.score` is
            # declared `float`, where `point.id` is genuinely `int | str` and
            # payload values are `Any`. The `str()` calls above are load-bearing
            # and this one was not.
            score=point.score,
        )
        for point in response.points
    ]


def qdrant_search_params(hnsw_ef: int):
    """Imported lazily-ish to keep the qdrant models import in one place."""
    from qdrant_client.http import models as qm

    return qm.SearchParams(hnsw_ef=hnsw_ef)


async def lexical_arm(
    pool: asyncpg.Pool,
    scope: TenantScope,
    query_text: str,
    limit: int,
) -> list[RetrievedChunk]:
    """Postgres full-text search with the SAME predicate as the semantic arm.

    Three things here are deliberate and each has a failure mode behind it:

      - **`vector_point_id` is SELECTed**, so fusion joins on the same key
        Qdrant returns rather than needing a second lookup per candidate.
      - **`'simple'`, not `'english'`** — matching the index. A mismatch
        between the query's text-search configuration and the index's means the
        index is silently not used, and the arm degrades to a sequential scan
        that still returns correct answers.
      - **The tenant clauses come FIRST in the WHERE**, before the text match,
        mirroring the composite index `(organization_id, to_tsvector(...))`.

    `vector_point_id IS NOT NULL` excludes chunks the pipeline wrote but never
    upserted — they are not retrievable from the other arm, and returning them
    from this one would make the two arms disagree about what exists.
    """
    sql = f"""
        SELECT
            vector_point_id::text AS vector_point_id,
            id::text              AS chunk_id,
            document_id::text     AS document_id,
            ts_rank(
                to_tsvector('simple', content_text),
                plainto_tsquery('simple', $3)
            ) AS score
        FROM document_chunks
        WHERE {scope.sql_where}
          AND vector_point_id IS NOT NULL
          AND to_tsvector('simple', content_text) @@ plainto_tsquery('simple', $3)
        ORDER BY score DESC
        LIMIT $4
    """

    async with pool.acquire() as connection:
        rows = await connection.fetch(sql, *scope.sql_args(), query_text, limit)

    return [
        RetrievedChunk(
            vector_point_id=row["vector_point_id"],
            chunk_id=row["chunk_id"],
            document_id=row["document_id"],
            score=float(row["score"]),
        )
        for row in rows
    ]
