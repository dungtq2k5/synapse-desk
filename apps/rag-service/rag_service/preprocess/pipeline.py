"""Layer 2 and reformulation — the two LLM calls before the answer.

Both are ledgered. Counting only the final generation was the metering hole RDM
Table 29 closes: a single factual question makes THREE metered calls before the
answer itself makes four.

**Reformulation runs only on the FACTUAL branch, and only when there is
history.** An earlier draft ran it first, which inverts the whole rationale for
two-layer detection: in any ongoing conversation — where history exists, so
reformulation cannot short-circuit — every "thanks!" and "ok got it" would pay
for an LLM rewrite before anything checked whether it was a greeting.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Protocol

from rag_service.enums import AiGenerationPurpose
from rag_service.ledger.client import GenerationEntry, LedgerClient
from rag_service.preprocess.greeting import (
    GreetingMatch,
    Intent,
    canned_reply,
    detect_greeting_layer_one,
)
from rag_service.retrieval.service import BudgetState
from rag_service.settings import AiSettings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Turn:
    """One prior message, oldest first."""

    role: str
    content: str


@dataclass
class Preprocessed:
    """What the pipeline decided, and what it cost."""

    intent: Intent
    #: The query to embed. Identical to the input unless reformulation ran.
    query: str
    #: Set only for a greeting — a canned string, never a generation.
    reply: str | None = None
    #: Which layer decided. Diagnostic, and the thing the cost tests assert on.
    decided_by: str = "layer_one"
    language: str | None = None
    llm_calls: list[str] = field(default_factory=list)


class TextGenerator(Protocol):
    """The minimal generation capability the preprocessing steps need."""

    async def generate(
        self, prompt: str, model: str, max_output_tokens: int
    ) -> GenerationOutput: ...


@dataclass(frozen=True)
class GenerationOutput:
    text: str
    prompt_tokens: int
    completion_tokens: int


#: The last few turns Layer 2 reads.
#:
#: It reads history DIRECTLY rather than a reformulated query, because it now
#: runs before reformulation — there is no rewritten query to read. Few, because
#: "is this a greeting" is answerable from the immediate context and a longer
#: window is prompt tokens charged on the highest-volume call in the system.
LAYER_TWO_HISTORY_TURNS = 4

#: A classification is one word. Anything longer is a model ignoring its
#: instructions, and capping it bounds the damage to a few tokens.
LAYER_TWO_MAX_TOKENS = 8

REFORMULATION_MAX_TOKENS = 128


class PreprocessPipeline:
    def __init__(
        self,
        generator: TextGenerator,
        ledger: LedgerClient,
        quota,
    ) -> None:
        self._generator = generator
        self._ledger = ledger
        self._quota = quota

    async def run(
        self,
        message: str,
        history: list[Turn],
        settings: AiSettings,
        *,
        budget: BudgetState,
        user_id: str | None = None,
    ) -> Preprocessed:
        """Layer 1 → Layer 2 → reformulation, stopping as early as it can."""
        # LAYER 1 — free, and first. A greeting now costs nothing at all and is
        # answered even at the cap.
        match = detect_greeting_layer_one(message)
        if match is not None:
            return self._greeting(match)

        if not budget.allows_embedding:
            # **At the cap, Layer 2 stops** (RDM §1.14). Unmatched input is
            # treated as factual and routes to escalation — which the caller
            # does. Paying for a classification that can only lead to a refusal
            # is spend with no possible benefit.
            return Preprocessed(
                intent=Intent.FACTUAL, query=message, decided_by="at_cap"
            )

        # LAYER 2 — the cheap tier, ledgered.
        intent = await self._classify(message, history, settings, budget, user_id)
        if intent is Intent.GREETING:
            return self._greeting(GreetingMatch(intent=intent), decided_by="layer_two")

        # REFORMULATION — only here, and only with history.
        query = message
        calls = [AiGenerationPurpose.GREETING_CLASSIFY.value]

        if history:
            query = await self._reformulate(message, history, settings, budget, user_id)
            calls.append(AiGenerationPurpose.REFORMULATION.value)

        return Preprocessed(
            intent=Intent.FACTUAL,
            query=query,
            decided_by="layer_two",
            llm_calls=calls,
        )

    def _greeting(
        self, match: GreetingMatch, decided_by: str = "layer_one"
    ) -> Preprocessed:
        """A canned reply and NO ledger row at all.

        Zero rows rather than a cheap row: there was no LLM call to record, and
        a row recording a call that never happened would make the ledger a
        worse record than no record.
        """
        return Preprocessed(
            intent=Intent.GREETING,
            query="",
            reply=canned_reply(match.language),
            decided_by=decided_by,
            language=match.language,
        )

    async def _classify(
        self,
        message: str,
        history: list[Turn],
        settings: AiSettings,
        budget: BudgetState,
        user_id: str | None,
    ) -> Intent:
        recent = history[-LAYER_TWO_HISTORY_TURNS:]
        transcript = "\n".join(f"{turn.role}: {turn.content}" for turn in recent)

        prompt = (
            "Classify the user's LAST message as either GREETING or FACTUAL.\n"
            "GREETING: social pleasantries, thanks, acknowledgements, farewells "
            "— messages that ask for no information.\n"
            "FACTUAL: anything asking for information, help, or action, even if "
            "it also contains a greeting.\n"
            "Answer with exactly one word.\n\n"
            f"{transcript}\n" if recent else ""
        ) + (
            "Classify the user's message as either GREETING or FACTUAL. "
            "GREETING means it asks for no information. Answer with one word.\n\n"
            if not recent
            else ""
        ) + f"user: {message}\n\nAnswer:"

        output = await self._spend(
            prompt,
            settings.cheap_model,
            LAYER_TWO_MAX_TOKENS,
            purpose=AiGenerationPurpose.GREETING_CLASSIFY,
            budget=budget,
            user_id=user_id,
        )
        if output is None:
            # A failed classification degrades to FACTUAL, never to GREETING.
            # Being wrong toward FACTUAL costs a retrieval; being wrong toward
            # GREETING deflects a real question with "Hi! How can I help?",
            # which is the answer a user is least able to recover from.
            return Intent.FACTUAL

        return (
            Intent.GREETING
            if output.text.strip().upper().startswith("GREET")
            else Intent.FACTUAL
        )

    async def _reformulate(
        self,
        message: str,
        history: list[Turn],
        settings: AiSettings,
        budget: BudgetState,
        user_id: str | None,
    ) -> str:
        """Rewrites a follow-up into a standalone query.

        "tell me more about it" retrieves nothing on its own — it has no nouns.
        With history it becomes "tell me more about the expense approval
        threshold", which retrieves.
        """
        transcript = "\n".join(f"{turn.role}: {turn.content}" for turn in history[-6:])

        prompt = (
            "Rewrite the user's last message as a standalone search query that "
            "makes sense without the conversation. Keep it short and keep the "
            "user's own wording where possible. Output only the query.\n\n"
            f"{transcript}\nuser: {message}\n\nStandalone query:"
        )

        output = await self._spend(
            prompt,
            settings.cheap_model,
            REFORMULATION_MAX_TOKENS,
            purpose=AiGenerationPurpose.REFORMULATION,
            budget=budget,
            user_id=user_id,
        )
        if output is None or not output.text.strip():
            # Falls back to the ORIGINAL message. A failed rewrite must not
            # produce an empty query — that retrieves nothing and reports as a
            # knowledge gap, which would blame the corpus for an LLM failure.
            return message

        return output.text.strip()

    async def _spend(
        self,
        prompt: str,
        model: str,
        max_output_tokens: int,
        *,
        purpose: str,
        budget: BudgetState,
        user_id: str | None,
    ) -> GenerationOutput | None:
        """One metered call: generate, CHARGE, then RECORD.

        The order is the design (RDM §1.14). The charge is awaited because it is
        the only thing standing between a burst of concurrent requests and all
        of them passing a stale gate; the row is fire-and-forget because the
        money is already spent by the time it runs.
        """
        started_at = time.monotonic()

        try:
            output = await self._generator.generate(prompt, model, max_output_tokens)
        except Exception as error:
            logger.warning("%s failed: %s", purpose, error)
            return None

        latency_ms = int((time.monotonic() - started_at) * 1000)

        from rag_service.pricing import estimate_cost_micros

        await self._quota.charge(
            budget.organization_id,
            budget.cycle_start,
            estimate_cost_micros(model, output.prompt_tokens, output.completion_tokens),
        )

        self._ledger.record(
            GenerationEntry(
                organization_id=budget.organization_id,
                user_id=user_id,
                purpose=purpose,
                model_name=model,
                prompt_tokens=output.prompt_tokens,
                completion_tokens=output.completion_tokens,
                latency_ms=latency_ms,
            )
        )

        return output
