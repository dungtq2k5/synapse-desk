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
        finish_reason: str | None = None

        stream = await self._client.aio.models.generate_content_stream(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(max_output_tokens=max_output_tokens),
        )

        async for response in stream:
            if response.text:
                yield GenerationDelta(text=response.text)

            # 17-doc §1.2 Gap 2 — the reason generation stopped.
            #
            # A truncated response and a badly-answered one are INDISTINGUISHABLE
            # downstream: hitting `max_output_tokens` cuts the JSON off
            # mid-object, `_json_object` finds nothing parseable and returns
            # `{}`, and the caller renders an empty summary. Same symptom as a
            # model that answered nonsense — but the fix is a one-line constant
            # change, and nothing in the logs points at it.
            #
            # Read here rather than returned: the empty result is still the
            # right OUTCOME. This is about being able to find out why.
            finish_reason = _finish_reason(response) or finish_reason

            usage = getattr(response, "usage_metadata", None)
            if usage is not None:
                # Overwritten rather than accumulated: the provider reports
                # RUNNING totals, so summing them would multiply the bill by
                # the number of frames.
                prompt_tokens = usage.prompt_token_count or prompt_tokens
                completion_tokens = usage.candidates_token_count or completion_tokens

        if finish_reason == "MAX_TOKENS":
            # WARN rather than error: the request succeeded and the caller
            # degrades correctly. It is a configuration signal — this surface's
            # token ceiling is too low for the answers it is being asked for —
            # and the class of bug where the diagnosis is impossible and the fix
            # is trivial is the one worth instrumenting.
            logger.warning(
                "Generation with %s hit max_output_tokens=%d and was truncated; "
                "any structured output is likely unparseable",
                model,
                max_output_tokens,
            )

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


def _finish_reason(response: object) -> str | None:
    """The candidate's finish reason, as a plain string.

    Defensive on every hop because this is diagnostics: a provider SDK that
    changes the shape of `candidates` must not be able to break generation
    itself. An unreadable finish reason costs a log line.

    The value is an enum in the SDK and a string on the wire, so `.name` is
    preferred and `str()` is the fallback.
    """
    try:
        candidates = getattr(response, "candidates", None) or []
        if not candidates:
            return None

        reason = getattr(candidates[0], "finish_reason", None)
        if reason is None:
            return None

        return getattr(reason, "name", None) or str(reason)
    except Exception:  # deliberately total
        # A bare `getattr` is not enough: an SDK attribute can be a property
        # that raises. Diagnostics must never be able to fail the thing they
        # observe, so the only cost of an unreadable shape is this log line.
        logger.debug("Could not read the finish reason", exc_info=True)

        return None
