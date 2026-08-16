"""Query embeddings — the query side of an ASYMMETRIC model.

Gemini's embedding models take a `task_type`, and documents and queries go into
the same space through different ones. The ingestion worker passes
`RETRIEVAL_DOCUMENT`; this passes `RETRIEVAL_QUERY`. Using one type for both
does not error and does not obviously break anything — it measurably degrades
retrieval, which is the kind of bug that gets attributed to "the model" for
months.

**Names no model.** The model arrives as an argument, resolved by the caller
from `settings_for(organization_id)`
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

from rag_service.qdrant.collection import EMBEDDING_DIMENSION

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmbeddingResult:
    vector: list[float]
    #: From the provider, never estimated. This number is money (RDM §1.14).
    prompt_tokens: int


class EmbeddingClient(Protocol):
    """The capability, as a protocol so tests can substitute it.

    A substitute must honour the contract completely (§2.3): the right
    dimensionality, a real token count, and an EXCEPTION on failure. A fake that
    returned a zero vector would be rejected by cosine distance in production
    and accepted in the test, which is the worst of both.
    """

    async def embed_query(self, text: str, model: str) -> EmbeddingResult: ...


class GeminiEmbeddingClient:
    """The real provider."""

    def __init__(self, api_key: str) -> None:
        from google import genai

        self._client = genai.Client(api_key=api_key)

    async def embed_query(self, text: str, model: str) -> EmbeddingResult:
        from google.genai import types

        response = await self._client.aio.models.embed_content(
            model=model,
            contents=text,
            config=types.EmbedContentConfig(
                # The QUERY side. See the module docstring — this one word is
                # the difference between retrieval that works and retrieval
                # that is quietly mediocre.
                task_type="RETRIEVAL_QUERY",
                output_dimensionality=EMBEDDING_DIMENSION,
            ),
        )

        embeddings = response.embeddings or []
        if not embeddings or not embeddings[0].values:
            raise RuntimeError("Embedding provider returned no vector")

        vector = list(embeddings[0].values)
        if len(vector) != EMBEDDING_DIMENSION:
            raise RuntimeError(
                f"Embedding provider returned a {len(vector)}-dim vector; "
                f"the collection is {EMBEDDING_DIMENSION}-dim"
            )

        return EmbeddingResult(
            vector=vector,
            prompt_tokens=_billable_tokens(response, text),
        )


def _billable_tokens(response: object, text: str) -> int:
    """The provider's own count, or an estimate that errs HIGH.

    Never zero. A zero-token call meters as free, which is exactly the hole the
    pricing table exists to close — and it would close it invisibly, reporting
    a tenant well under budget while they spent freely.
    """
    metadata = getattr(response, "metadata", None)
    billable = getattr(metadata, "billable_character_count", None)

    if isinstance(billable, int) and billable > 0:
        return billable

    logger.warning("Embedding response carried no usage metadata; charging an estimate")

    return max(1, len(text) // 4)
