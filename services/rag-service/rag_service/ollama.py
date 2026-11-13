"""The local provider: generation and query embeddings through an Ollama server.

**Names no model.** The model arrives as an argument, resolved by the caller
from `settings_for(organization_id)`, exactly as for `gemini.py`.

Three things differ from Gemini, and each is decided here rather than by a
caller:

- **`num_ctx` on every call.** Ollama's default context is small and it
  truncates a long prompt silently, from the front: five chunks, the history
  and the instructions stop fitting with no error. `OLLAMA_NUM_CTX` sets it.
- **Asymmetric embeddings through prefixes.** The nomic embedder puts queries
  and documents into one space through `search_query: ` and
  `search_document: `, as Gemini does through task types. This is the query
  side; ingestion-service's client is the document side.
- **Text-only models.** Text attachments (plain, Markdown, CSV, and the
  Markdown ticket-service extracts from `.docx` / `.xlsx`) are inlined into
  the prompt. An image or a PDF can't be read, so the prompt says so in one
  line and the answer can be honest about it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from collections.abc import AsyncIterator

import httpx

from rag_service.embeddings import EmbeddingResult
from rag_service.generation.corag import GenerationDelta
from rag_service.generation.parts import Attachment, Prompt
from rag_service.qdrant.collection import EMBEDDING_DIMENSION

logger = logging.getLogger(__name__)

#: The query side of nomic-embed-text's asymmetric space.
QUERY_PREFIX = "search_query: "


def _timeout(read_s: float) -> httpx.Timeout:
    """httpx's `read` is per read, so on a stream it is the idle deadline."""
    return httpx.Timeout(connect=5.0, read=read_s, write=30.0, pool=30.0)


def _is_text(mime_type: str) -> bool:
    return mime_type.startswith("text/")


def to_ollama_prompt(prompt: Prompt) -> str:
    """`Prompt` -> one string a text-only model can read.

    Text attachments are inlined, each fenced by an id generated here and
    stripped from the file's own text, so a file can't close its fence and
    write past it. Images and PDFs become one line each.

    >>> to_ollama_prompt("Hello")
    'Hello'
    """
    if isinstance(prompt, str):
        return prompt

    fence = secrets.token_hex(8)
    parts: list[str] = []
    for part in prompt:
        if isinstance(part, str):
            parts.append(part)
        elif _is_text(part.mime_type):
            parts.append(_inline(part, fence))
        else:
            parts.append(
                f"\n{part.file_name} is attached, but this model reads text only.\n"
            )

    return "".join(parts)


def _inline(attachment: Attachment, fence: str) -> str:
    text = attachment.data.decode("utf-8", errors="replace").replace(fence, "")
    name = attachment.file_name.replace(fence, "")
    return f'\n<file name="{name}" id="{fence}">\n{text}\n</file id="{fence}">\n'


class OllamaGenerator:
    """Streamed generation against `/api/generate`.

    `idle_timeout_s` bounds each wait for the next frame, the first included:
    on the CPU a long prompt takes minutes before the first token, so the
    default covers that, and a stream that stops sending fails at it.
    """

    def __init__(
        self, base_url: str, num_ctx: int, idle_timeout_s: float = 300.0
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url, timeout=_timeout(idle_timeout_s)
        )
        self._num_ctx = num_ctx

    async def stream(
        self, prompt: Prompt, model: str, max_output_tokens: int
    ) -> AsyncIterator[GenerationDelta]:
        """Yields text deltas, then one final frame carrying Ollama's own usage.

        `prompt_eval_count` and `eval_count` come on the last frame only. A
        frame that never arrives (the server dropped mid-stream) raises rather
        than reporting zero: a zero-token call meters as free.
        """
        body = {
            "model": model,
            "prompt": to_ollama_prompt(prompt),
            "stream": True,
            "options": {"num_ctx": self._num_ctx, "num_predict": max_output_tokens},
        }
        async with self._client.stream("POST", "/api/generate", json=body) as response:
            if response.status_code != 200:
                detail = (await response.aread()).decode(errors="replace")
                raise RuntimeError(
                    f"Ollama answered {response.status_code} for {model}: {detail}"
                )

            async for line in response.aiter_lines():
                if not line:
                    continue
                frame = json.loads(line)
                if frame.get("error"):
                    raise RuntimeError(f"Ollama failed for {model}: {frame['error']}")
                if frame.get("response"):
                    yield GenerationDelta(text=frame["response"])
                if frame.get("done"):
                    if frame.get("done_reason") == "length":
                        # The same configuration signal as Gemini's MAX_TOKENS.
                        logger.warning(
                            "Generation with %s hit max_output_tokens=%d and was "
                            "truncated; any structured output is likely "
                            "unparseable",
                            model,
                            max_output_tokens,
                        )
                    yield GenerationDelta(
                        done=True,
                        prompt_tokens=max(1, int(frame.get("prompt_eval_count", 0))),
                        completion_tokens=int(frame.get("eval_count", 0)),
                    )
                    return

        raise RuntimeError(f"Ollama's stream for {model} ended without a final frame")

    async def generate(self, prompt: Prompt, model: str, max_output_tokens: int):
        """The unary form, built on `stream` so usage is read one way only."""
        from rag_service.preprocess.pipeline import GenerationOutput

        parts: list[str] = []
        prompt_tokens = 0
        completion_tokens = 0

        async for delta in self.stream(prompt, model, max_output_tokens):
            if delta.text:
                parts.append(delta.text)
            if delta.done:
                prompt_tokens = delta.prompt_tokens
                completion_tokens = delta.completion_tokens

        return GenerationOutput(
            text="".join(parts),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )


class OllamaEmbeddingClient:
    """Query embeddings against `/api/embed`, each with a total deadline."""

    def __init__(self, base_url: str, num_ctx: int, timeout_s: float = 120.0) -> None:
        self._client = httpx.AsyncClient(base_url=base_url, timeout=_timeout(timeout_s))
        self._num_ctx = num_ctx
        self._timeout = timeout_s

    async def embed_query(self, text: str, model: str) -> EmbeddingResult:
        try:
            return await asyncio.wait_for(self._embed(text, model), self._timeout)
        except TimeoutError as error:
            raise TimeoutError(
                f"Ollama sent no embedding for {self._timeout:g} s on {model}"
            ) from error

    async def _embed(self, text: str, model: str) -> EmbeddingResult:
        response = await self._client.post(
            "/api/embed",
            json={
                "model": model,
                # The QUERY side; ingestion embeds with `search_document: `.
                "input": [QUERY_PREFIX + text],
                "options": {"num_ctx": self._num_ctx},
            },
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"Ollama answered {response.status_code} for {model}: {response.text}"
            )
        body = response.json()
        vectors = body.get("embeddings") or []
        if not vectors or not vectors[0]:
            raise RuntimeError("Embedding provider returned no vector")

        vector = [float(value) for value in vectors[0]]
        if len(vector) != EMBEDDING_DIMENSION:
            raise RuntimeError(
                f"Embedding provider returned a {len(vector)}-dim vector; "
                f"the collection is {EMBEDDING_DIMENSION}-dim"
            )

        tokens = int(body.get("prompt_eval_count") or 0)
        if tokens <= 0:
            logger.warning("Ollama reported no token count; charging an estimate")
            tokens = max(1, len(text) // 4)

        return EmbeddingResult(vector=vector, prompt_tokens=tokens)


async def check_ollama(
    base_url: str, models: list[str], digests: dict[str, str]
) -> None:
    """Fails the boot with the fix named: unreachable, unpulled, or re-pulled.

    `models` are the ones this service is configured to call. A digest that
    differs from `digests` means the tag now names other weights than the
    ones the prices and the eval baseline were measured on.
    """
    try:
        async with httpx.AsyncClient(base_url=base_url, timeout=10.0) as client:
            response = await client.get("/api/tags")
            response.raise_for_status()
    except httpx.HTTPError as error:
        raise RuntimeError(
            f"OLLAMA_BASE_URL {base_url} doesn't answer ({error}). Start it with "
            "`docker compose up -d ollama`, or set the provider back to gemini."
        ) from error

    pulled = {
        entry["name"]: entry.get("digest", "")
        for entry in response.json().get("models", [])
    }
    for model in models:
        if model not in pulled:
            raise RuntimeError(
                f"Ollama at {base_url} has no {model}: run `ollama pull {model}`."
            )
        expected = digests.get(model)
        if expected and pulled[model] != expected:
            raise RuntimeError(
                f"Ollama's {model} is {pulled[model][:12]}, not the pinned "
                f"{expected[:12]}: the tag was re-pulled onto other weights. "
                "Pull the pinned digest, or re-measure and update "
                "OLLAMA_MODEL_DIGESTS."
            )
