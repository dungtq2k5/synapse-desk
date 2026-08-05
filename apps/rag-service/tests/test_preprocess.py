"""§3 — greeting detection then reformulation, and the ORDER between them.

The most valuable test in this file is the ordering one. Reversing the two
steps costs money on every social turn of every conversation and changes no
visible behaviour — so without a test that fails, the regression is invisible
except on the bill.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from rag_service.preprocess.greeting import (
    Intent,
    canned_reply,
    detect_greeting_layer_one,
)
from rag_service.preprocess.pipeline import (
    GenerationOutput,
    PreprocessPipeline,
    Turn,
)
from rag_service.retrieval.service import BudgetState
from rag_service.settings import resolve_ai_settings
from tests.fakes import FakeAbort  # noqa: F401 - keeps one import root

CYCLE = datetime(2026, 8, 1, tzinfo=timezone.utc)


class RecordingGenerator:
    """Answers whatever it is told to, and records every call."""

    def __init__(self, answers: list[str] | None = None) -> None:
        self.calls: list[tuple[str, str]] = []
        self.answers = answers or []
        self.fail_next: Exception | None = None

    async def generate(self, prompt: str, model: str, max_output_tokens: int):
        self.calls.append((prompt, model))

        if self.fail_next is not None:
            error, self.fail_next = self.fail_next, None
            raise error

        text = self.answers.pop(0) if self.answers else "FACTUAL"

        return GenerationOutput(text=text, prompt_tokens=20, completion_tokens=2)


class NullQuota:
    async def charge(self, *_args, **_kwargs):
        return None


@pytest.fixture
def generator() -> RecordingGenerator:
    return RecordingGenerator()


@pytest.fixture
def pipeline(generator, ledger):
    return PreprocessPipeline(generator, ledger, NullQuota())


@pytest.fixture
def settings():
    return resolve_ai_settings("FAST")


@pytest.fixture
def budget():
    return BudgetState(
        organization_id="org", cycle_start=CYCLE, allows_embedding=True
    )


@pytest.fixture
def at_cap_budget():
    return BudgetState(
        organization_id="org", cycle_start=CYCLE, allows_embedding=False
    )


class TestLayerOne:
    @pytest.mark.parametrize(
        ("text", "language"),
        [
            ("hi", "en"),
            ("thanks!", "en"),
            ("ok got it", "en"),
            ("gracias", "es"),
            ("merci beaucoup", "fr"),
            ("danke", "de"),
            ("obrigado", "pt"),
            ("cảm ơn", "vi"),
            ("ありがとう", "ja"),
            ("谢谢", "zh"),
        ],
    )
    def test_catches_greetings_in_every_supported_language(self, text, language):
        # An English-only list silently pushes every other language to Layer 2,
        # so a Spanish-speaking tenant pays a model call for every "gracias"
        # while an English one pays nothing. The bill rises quietly and the
        # cause looks like usage rather than a regex.
        match = detect_greeting_layer_one(text)

        assert match is not None
        assert match.intent is Intent.GREETING
        assert match.language == language

    def test_a_question_that_OPENS_with_a_greeting_is_not_a_greeting(self):
        # The greedy-prefix guard. Without it the user who types "hi, what's
        # the refund policy?" gets "Hi! How can I help?" in response to having
        # asked exactly that.
        assert detect_greeting_layer_one("hi, what's the refund policy?") is None
        assert detect_greeting_layer_one("thanks — but how do I reset my password?") is None

    def test_an_empty_message_is_not_a_greeting(self):
        assert detect_greeting_layer_one("") is None
        assert detect_greeting_layer_one("   ") is None

    def test_replies_in_the_language_it_detected(self):
        assert canned_reply("es").startswith("¡Hola")
        # Falls back rather than returning nothing, for a language Layer 2
        # decided on and therefore never identified.
        assert canned_reply(None) == canned_reply("en")


class TestOrdering:
    """The ordering fix, made mechanical."""

    async def test_a_greeting_WITH_history_makes_zero_llm_calls(
        self, pipeline, generator, settings, budget, ledger
    ):
        # THE test. An earlier draft ran reformulation first, so in any ongoing
        # conversation every "thanks!" paid for an LLM rewrite before anything
        # checked whether it was a greeting. Nothing about the behaviour
        # changes — only the bill.
        history = [
            Turn(role="user", content="what is the expense threshold?"),
            Turn(role="assistant", content="It is 500 per claim."),
        ]

        result = await pipeline.run("thanks!", history, settings, budget=budget)

        assert result.intent is Intent.GREETING
        assert generator.calls == []
        assert ledger.entries == []

    async def test_a_layer_one_hit_writes_NO_ledger_row_at_all(
        self, pipeline, settings, budget, ledger
    ):
        # Zero rows, not a cheap row: there was no call to record, and a row
        # recording a call that never happened makes the ledger worse than no
        # record.
        await pipeline.run("hello", [], settings, budget=budget)

        assert ledger.entries == []

    async def test_reformulation_is_skipped_when_there_is_no_history(
        self, pipeline, generator, settings, budget, ledger
    ):
        result = await pipeline.run("what is the policy?", [], settings, budget=budget)

        assert result.query == "what is the policy?"
        assert [entry.purpose for entry in ledger.entries] == ["GREETING_CLASSIFY"]

    async def test_reformulation_runs_only_after_a_FACTUAL_classification(
        self, generator, ledger, settings, budget
    ):
        generator.answers = ["FACTUAL", "expense approval threshold for travel"]
        pipeline = PreprocessPipeline(generator, ledger, NullQuota())

        result = await pipeline.run(
            "tell me more about it",
            [Turn(role="user", content="what is the expense approval threshold?")],
            settings,
            budget=budget,
        )

        assert result.query == "expense approval threshold for travel"
        assert [entry.purpose for entry in ledger.entries] == [
            "GREETING_CLASSIFY",
            "REFORMULATION",
        ]


class TestLayerTwo:
    async def test_uses_the_CHEAP_model_from_the_settings_layer(
        self, pipeline, generator, settings, budget
    ):
        # Doc 15 §2.2: the cheap model does not scale with the tier. These are
        # volume calls whose quality barely moves with model tier, so scaling
        # them multiplies a premium tenant's bill for no perceptible gain.
        await pipeline.run("what is the policy?", [], settings, budget=budget)

        assert [model for _, model in generator.calls] == [settings.cheap_model]

    async def test_a_layer_two_GREETING_is_answered_from_the_canned_table(
        self, generator, ledger, settings, budget
    ):
        generator.answers = ["GREETING"]
        pipeline = PreprocessPipeline(generator, ledger, NullQuota())

        result = await pipeline.run(
            "much appreciated, friend", [], settings, budget=budget
        )

        assert result.intent is Intent.GREETING
        assert result.reply == canned_reply("en")
        # The classification WAS a call and IS recorded — unlike a Layer 1 hit.
        assert [entry.purpose for entry in ledger.entries] == ["GREETING_CLASSIFY"]

    async def test_a_failed_classification_degrades_to_FACTUAL(
        self, generator, ledger, settings, budget
    ):
        # Never to GREETING. Being wrong toward FACTUAL costs a retrieval;
        # being wrong toward GREETING deflects a real question with "Hi! How
        # can I help?", which is what a user is least able to recover from.
        generator.fail_next = RuntimeError("model unavailable")
        pipeline = PreprocessPipeline(generator, ledger, NullQuota())

        result = await pipeline.run("what is the policy?", [], settings, budget=budget)

        assert result.intent is Intent.FACTUAL

    async def test_a_failed_reformulation_falls_back_to_the_original_message(
        self, generator, ledger, settings, budget
    ):
        # An empty query would retrieve nothing and report as a knowledge gap,
        # blaming the corpus for an LLM failure.
        generator.answers = ["FACTUAL"]
        pipeline = PreprocessPipeline(generator, ledger, NullQuota())

        original = "tell me more about it"

        async def failing(prompt, model, max_output_tokens):
            generator.calls.append((prompt, model))
            if "Standalone query" in prompt:
                raise RuntimeError("model unavailable")
            return GenerationOutput("FACTUAL", 10, 1)

        generator.generate = failing  # type: ignore[method-assign]

        result = await pipeline.run(
            original,
            [Turn(role="user", content="what is the threshold?")],
            settings,
            budget=budget,
        )

        assert result.query == original


class TestAtCap:
    async def test_layer_two_is_SKIPPED_at_the_cap(
        self, pipeline, generator, settings, at_cap_budget, ledger
    ):
        # RDM §1.14. Paying for a classification that can only lead to a
        # refusal is spend with no possible benefit.
        result = await pipeline.run(
            "what is the policy?", [], settings, budget=at_cap_budget
        )

        assert result.intent is Intent.FACTUAL
        assert result.decided_by == "at_cap"
        assert generator.calls == []
        assert ledger.entries == []

    async def test_layer_one_greetings_STILL_answer_at_the_cap(
        self, pipeline, settings, at_cap_budget
    ):
        # The canned reply is free and instant, so a capped tenant's users
        # still get a sensible answer to "thanks".
        result = await pipeline.run("thanks!", [], settings, budget=at_cap_budget)

        assert result.intent is Intent.GREETING
        assert result.reply
