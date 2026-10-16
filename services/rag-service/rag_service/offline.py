"""A model-free provider, for the end-to-end stack only.

Switched on by `RAG_OFFLINE_MODEL`, and refused under `APP_ENV=production` (see
`select_providers`). It answers every call without a network or a key, the
same way on every machine, so an end-to-end run means the same locally and in
CI. The real model stays covered by this service's own live tests.

- **Embeddings** are a fixed function of the text: each word is hashed into
  one of the vector's dimensions, so the same text always gets the same
  vector, and texts sharing words land near each other, the way keyword
  matches would rank.
- **Generation** answers from the numbered sources in the prompt with fixed
  text, citing each one (`[1]`, `[2]`). A prompt with no sources gets an empty
  JSON object, which the structured callers (summaries, routing, suggestions)
  read as "nothing to say". Retrieval that finds nothing never reaches
  generation: the caller answers `DOC_MISSING` itself.
- **One-shot calls** (the greeting and injection classifications, the query
  rewrite) get an empty answer, which each caller reads as its safe default:
  `FACTUAL`, and the original question.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import AsyncIterator

from rag_service.embeddings import EmbeddingResult
from rag_service.generation.corag import GenerationDelta
from rag_service.generation.parts import Prompt
from rag_service.qdrant.collection import EMBEDDING_DIMENSION

#: The answer's fixed text, before its citations.
OFFLINE_ANSWER = "This answer comes from the offline model, citing"

#: A numbered source as `build_prompt` writes it: `[1] (from "Title"...`.
_SOURCE = re.compile(r'^\[(\d+)\] \(from "', re.MULTILINE)
_WORD = re.compile(r"\w+", re.UNICODE)


def offline_vector(text: str) -> list[float]:
    """The text's words, hashed into dimensions, normalized; never all-zero.

    >>> offline_vector("annual leave") == offline_vector("annual leave")
    True
    """
    vector = [0.0] * EMBEDDING_DIMENSION
    for word in _WORD.findall(text.lower()):
        digest = hashlib.sha256(word.encode()).digest()
        vector[int.from_bytes(digest[:4], "big") % EMBEDDING_DIMENSION] += 1.0
    # A text with no words still needs a vector cosine distance accepts.
    vector[0] += 1e-3
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector]


def _prompt_text(prompt: Prompt) -> str:
    return prompt if isinstance(prompt, str) else str(prompt[0])


def offline_answer(prompt: Prompt) -> str:
    """The fixed answer, citing every numbered source the prompt holds.

    >>> offline_answer('[1] (from "A")\\nx\\n\\n[2] (from "B")\\ny')
    'This answer comes from the offline model, citing [1] [2].'
    >>> offline_answer("no sources")
    '{}'
    """
    sources = sorted({int(number) for number in _SOURCE.findall(_prompt_text(prompt))})
    if not sources:
        return "{}"
    return f"{OFFLINE_ANSWER} " + " ".join(f"[{n}]" for n in sources) + "."


class OfflineEmbeddingClient:
    """`EmbeddingClient`, with no provider."""

    async def embed_query(self, text: str, model: str) -> EmbeddingResult:
        return EmbeddingResult(
            vector=offline_vector(text), prompt_tokens=max(1, len(text) // 4)
        )


class OfflineGenerator:
    """`ProviderClient`, with no provider: the same answer for the same prompt."""

    async def stream(
        self, prompt: Prompt, model: str, max_output_tokens: int
    ) -> AsyncIterator[GenerationDelta]:
        text = offline_answer(prompt)
        yield GenerationDelta(text=text)
        yield GenerationDelta(
            done=True,
            prompt_tokens=max(1, len(_prompt_text(prompt)) // 4),
            completion_tokens=max(1, len(text) // 4),
        )

    async def generate(self, prompt: Prompt, model: str, max_output_tokens: int):
        from rag_service.preprocess.pipeline import GenerationOutput

        # Empty: each one-shot caller reads it as its safe default.
        return GenerationOutput(
            text="",
            prompt_tokens=max(1, len(_prompt_text(prompt)) // 4),
            completion_tokens=0,
        )
