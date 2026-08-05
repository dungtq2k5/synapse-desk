"""The real generation provider, streamed.

**Names no model.** The model arrives as an argument, resolved by the caller
from `settings_for(organization_id)` — doc 15 §1.2.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from rag_service.generation.corag import GenerationDelta

logger = logging.getLogger(__name__)


class GeminiGenerator:
    def __init__(self, api_key: str) -> None:
        from google import genai

        self._client = genai.Client(api_key=api_key)

    async def stream(
        self, prompt: str, model: str, max_output_tokens: int
    ) -> AsyncIterator[GenerationDelta]:
        """Yields text deltas, then one final frame carrying the USAGE.

        Usage last rather than per-delta because the provider only knows the
        totals once generation ends — and a per-delta estimate would be charged
        against the tenant as if it were measured.
        """
        from google.genai import types

        prompt_tokens = 0
        completion_tokens = 0

        stream = await self._client.aio.models.generate_content_stream(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(max_output_tokens=max_output_tokens),
        )

        async for response in stream:
            if response.text:
                yield GenerationDelta(text=response.text)

            usage = getattr(response, "usage_metadata", None)
            if usage is not None:
                # Overwritten rather than accumulated: the provider reports
                # RUNNING totals, so summing them would multiply the bill by
                # the number of frames.
                prompt_tokens = usage.prompt_token_count or prompt_tokens
                completion_tokens = usage.candidates_token_count or completion_tokens

        yield GenerationDelta(
            done=True,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )

    async def generate(
        self, prompt: str, model: str, max_output_tokens: int
    ):
        """The unary form, for the preprocessing steps.

        Built on the streaming one so there is a single provider call path —
        two would eventually disagree about how usage is read, and that
        disagreement is a billing bug rather than a code-style one.
        """
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
