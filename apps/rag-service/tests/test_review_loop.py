"""§4.2 test 3 — the co-pilot's review loop, and the two ways it must not fail.

The loop is the co-pilot's whole differentiator: the same generator Tier 1 chat
uses, with review passes an agent's latency budget can afford. The tests that
matter are not "does it improve the draft" — nothing here can judge that — but:

  - it is **BOUNDED**, because an unbounded refine loop is an unbounded bill;
  - **every pass is metered**, because one request making three generations is
    where a metering hole is widest.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from rag_service.enums import AiGenerationPurpose
from rag_service.generation.corag import CoRagGenerator, GenerationDelta
from rag_service.generation.review import (
    ReviewVerdict,
    build_refine_prompt,
    parse_review,
)
from rag_service.retrieval.service import BudgetState, HydratedChunk
from rag_service.settings import resolve_ai_settings

CYCLE = datetime(2026, 8, 1, tzinfo=timezone.utc)


def chunk(index: int) -> HydratedChunk:
    return HydratedChunk(
        chunk_id=f"chunk-{index}",
        document_id=f"doc-{index}",
        document_title="Handbook",
        page_number=4,
        chunk_index=index,
        content_text=f"Policy text number {index}.",
        score=1.0,
        vector_point_id=f"point-{index}",
    )


class ScriptedPasses:
    """Answers each pass from a script, so a whole loop is deterministic.

    Keyed on what the prompt IS rather than on call order: the loop makes
    review and refine calls in an order the test is trying to observe, so
    scripting by position would encode the answer into the fixture.
    """

    def __init__(self, reviews: list[str], refinements: list[str] | None = None):
        self.reviews = list(reviews)
        self.refinements = list(refinements or [])
        self.calls: list[tuple[str, str]] = []

    async def stream(self, prompt: str, model: str, max_output_tokens: int):
        self.calls.append((_kind(prompt), model))

        if _kind(prompt) == "review":
            text = self.reviews.pop(0) if self.reviews else "COMPLETE\n"
        elif _kind(prompt) == "refine":
            text = self.refinements.pop(0) if self.refinements else "Refined [1]."
        else:
            text = "The limit is 500 [1]."

        yield GenerationDelta(text=text)
        yield GenerationDelta(done=True, prompt_tokens=400, completion_tokens=20)


def _kind(prompt: str) -> str:
    if "REVIEW:" in prompt:
        return "review"
    if "IMPROVED REPLY:" in prompt:
        return "refine"
    return "draft"


class NullQuota:
    def __init__(self) -> None:
        self.charges: list[int] = []

    async def charge(self, _org, _cycle, cost_micros):
        self.charges.append(cost_micros)


@pytest.fixture
def settings():
    return resolve_ai_settings("FAST")


@pytest.fixture
def budget():
    return BudgetState(organization_id="org", cycle_start=CYCLE, allows_embedding=True)


@pytest.fixture
def quota():
    return NullQuota()


async def run_reviewed(generator, ledger, quota, settings, budget, max_retries):
    corag = CoRagGenerator(generator, ledger, quota)

    return await corag.generate_reviewed(
        "what is the limit?",
        [chunk(1)],
        settings,
        budget=budget,
        purpose=AiGenerationPurpose.DRAFT,
        retrieved_chunk_ids=["chunk-1"],
        max_retries=max_retries,
    )


class TestTheLoop:
    async def test_a_COMPLETE_review_stops_after_one_pass(
        self, ledger, quota, settings, budget
    ):
        generator = ScriptedPasses(reviews=["COMPLETE\n"])

        await run_reviewed(generator, ledger, quota, settings, budget, max_retries=2)

        assert [kind for kind, _ in generator.calls] == ["draft", "review"]

    async def test_PARTIAL_refines_and_re_reviews(
        self, ledger, quota, settings, budget
    ):
        # §4.2 test 3. PARTIAL → refine → review, and COMPLETE on the second
        # pass ends it.
        generator = ScriptedPasses(
            reviews=["PARTIAL\nMissing the carryover limit.", "COMPLETE\n"],
            refinements=["The limit is 500, carried over once [1]."],
        )

        answer = await run_reviewed(
            generator, ledger, quota, settings, budget, max_retries=2
        )

        assert [kind for kind, _ in generator.calls] == [
            "draft",
            "review",
            "refine",
            "review",
        ]
        assert answer.content == "The limit is 500, carried over once [1]."

    async def test_the_loop_is_BOUNDED_by_max_retries(
        self, ledger, quota, settings, budget
    ):
        # A reviewer that never says COMPLETE — because the sources genuinely
        # do not answer the question — would otherwise spend until the cap
        # stopped it. The bound is the retry budget, not the reviewer's
        # opinion.
        generator = ScriptedPasses(reviews=["PARTIAL\nstill not right"] * 10)

        await run_reviewed(generator, ledger, quota, settings, budget, max_retries=2)

        assert [kind for kind, _ in generator.calls].count("review") == 2
        assert [kind for kind, _ in generator.calls].count("refine") == 2

    async def test_max_retries_ZERO_is_exactly_the_streamed_path(
        self, ledger, quota, settings, budget
    ):
        # Tier 1 chat's configuration. One generation on the hot path, no
        # review — and it must be the SAME code path, or the streamed answer
        # and the reviewed draft drift apart in what they record.
        generator = ScriptedPasses(reviews=["PARTIAL\nwould refine"])

        await run_reviewed(generator, ledger, quota, settings, budget, max_retries=0)

        assert [kind for kind, _ in generator.calls] == ["draft"]

    async def test_an_empty_retrieval_is_never_reviewed(
        self, ledger, quota, settings, budget
    ):
        # There is nothing to review against — the sources are the yardstick —
        # and paying a model to confirm that a canned refusal is a canned
        # refusal is spend with no possible finding.
        generator = ScriptedPasses(reviews=["PARTIAL\n"])
        corag = CoRagGenerator(generator, ledger, quota)

        answer = await corag.generate_reviewed(
            "what is the limit?",
            [],
            settings,
            budget=budget,
            purpose=AiGenerationPurpose.DRAFT,
            retrieved_chunk_ids=[],
            max_retries=2,
        )

        assert answer.status == "DOC_MISSING"
        assert generator.calls == []


class TestMetering:
    async def test_EVERY_pass_is_charged_and_recorded(
        self, ledger, quota, settings, budget
    ):
        # Three generations for one draft is three ledger rows and three
        # charges. Counting only the final one is the metering hole at its
        # widest — one request, the most calls.
        generator = ScriptedPasses(
            reviews=["PARTIAL\nfix it", "COMPLETE\n"],
            refinements=["Refined [1]."],
        )

        await run_reviewed(generator, ledger, quota, settings, budget, max_retries=2)

        assert len(ledger.entries) == len(generator.calls) == 4
        assert len(quota.charges) == 4
        assert all(cost > 0 for cost in quota.charges)

    async def test_review_passes_are_recorded_under_their_OWN_purpose(
        self, ledger, quota, settings, budget
    ):
        # A distinct purpose because it is a distinct cost: folding reviews
        # under DRAFT would make the per-draft price look like one call,
        # understating the co-pilot by exactly the factor that makes it worth
        # having.
        generator = ScriptedPasses(
            reviews=["PARTIAL\nfix it", "COMPLETE\n"],
            refinements=["Refined [1]."],
        )

        await run_reviewed(generator, ledger, quota, settings, budget, max_retries=2)

        purposes = [entry.purpose for entry in ledger.entries]
        assert purposes.count(AiGenerationPurpose.REVIEW) == 2
        # The refine is recorded as a DRAFT — it IS the draft the agent sees,
        # and the acceptance loop needs the last one to carry that content.
        assert purposes.count(AiGenerationPurpose.DRAFT) == 2

    async def test_the_review_runs_on_the_CHEAP_model(
        self, ledger, quota, settings, budget
    ):
        # Judging "is this grounded in these passages" is a comparison rather
        # than a composition, and scaling it with the tier would multiply a
        # premium tenant's bill on the pass least likely to benefit.
        generator = ScriptedPasses(reviews=["COMPLETE\n"])

        await run_reviewed(generator, ledger, quota, settings, budget, max_retries=1)

        review_calls = [model for kind, model in generator.calls if kind == "review"]
        assert review_calls == [settings.cheap_model]

    async def test_the_LAST_draft_is_what_the_ledger_carries(
        self, ledger, quota, settings, budget
    ):
        # The acceptance loop compares the sent text against the stored draft.
        # Storing the FIRST one would report every accepted refinement as
        # EDITED — understating the metric the whole feature is judged on.
        generator = ScriptedPasses(
            reviews=["PARTIAL\nfix it", "COMPLETE\n"],
            refinements=["The refined answer [1]."],
        )

        await run_reviewed(generator, ledger, quota, settings, budget, max_retries=2)

        drafts = [
            entry.content
            for entry in ledger.entries
            if entry.purpose == AiGenerationPurpose.DRAFT
        ]
        assert drafts[-1] == "The refined answer [1]."


class TestVerdictParsing:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("COMPLETE\n", ReviewVerdict.COMPLETE),
            ("PARTIAL\nneeds the limit", ReviewVerdict.PARTIAL),
            ("UNGROUNDED\ninvented a number", ReviewVerdict.UNGROUNDED),
            ("  partial  \nlowercase", ReviewVerdict.PARTIAL),
        ],
    )
    def test_reads_the_verdict_from_the_first_line(self, text, expected):
        assert parse_review(text).verdict is expected

    def test_reads_PARTIALLY_UNGROUNDED_as_the_WORSE_of_the_two(self):
        # A model writing both words should be read as the more serious
        # finding, not as whichever appears first in the string.
        assert parse_review("PARTIALLY UNGROUNDED\n").verdict is ReviewVerdict.UNGROUNDED

    def test_an_unparseable_review_defaults_to_COMPLETE(self):
        # The opposite of the usual instinct, and deliberate: an unparseable
        # review means the REVIEWER failed, not that the draft is bad. Treating
        # it as PARTIAL would spend another generation on every malformed
        # response, turning one flaky model into a doubled bill — and the draft
        # still reaches a human before it reaches a customer.
        assert parse_review("I think it looks fine!").verdict is ReviewVerdict.COMPLETE
        assert parse_review("").verdict is ReviewVerdict.COMPLETE

    def test_carries_the_critique_into_the_refine_prompt(self):
        review = parse_review("PARTIAL\nMissing the carryover limit.")
        prompt = build_refine_prompt("q", "draft", review.critique, [chunk(1)])

        assert "Missing the carryover limit." in prompt
        # The sources are REPEATED. Each pass is an independent call with no
        # shared state, so a refine prompt without them asks the model to
        # improve a text from general knowledge — the behaviour §1.6 forbids,
        # arriving through the quality mechanism.
        assert "Policy text number 1." in prompt


class TestUngroundedDowngrade:
    async def test_a_draft_that_stays_UNGROUNDED_is_reported_as_DOC_MISSING(
        self, ledger, quota, settings, budget
    ):
        # Rather than shipped as an answer with a green tick on it. The sources
        # did not support it, and saying so is what §1.6 asks for.
        generator = ScriptedPasses(reviews=["UNGROUNDED\ninvented"] * 5)

        answer = await run_reviewed(
            generator, ledger, quota, settings, budget, max_retries=1
        )

        assert answer.status == "DOC_MISSING"

    async def test_citations_are_RE_DERIVED_from_the_final_text(
        self, ledger, quota, settings, budget
    ):
        # A refined draft cites different sources from the one it replaced.
        # Carrying the old list forward would report the model as having used
        # passages it no longer mentions — and `cited ⊆ retrieved` would still
        # hold while being wrong.
        generator = ScriptedPasses(
            reviews=["PARTIAL\nfix", "COMPLETE\n"],
            refinements=["No citation markers at all here."],
        )

        answer = await run_reviewed(
            generator, ledger, quota, settings, budget, max_retries=2
        )

        assert answer.citations == []
