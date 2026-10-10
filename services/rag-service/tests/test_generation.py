"""Co-RAG generation, streaming, and the two things that must not break.

The most valuable tests here are the metering ones. A generation that produces a
perfect answer and records nothing is indistinguishable from a working system
until an invoice arrives, and a cancelled stream is the case where the NATURAL
implementation is the broken one.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import pytest

from rag_service.generation.corag import (
    DOC_MISSING_WITH_HANDOFF,
    MAX_REPORTED_TERMS,
    CoRagGenerator,
    GeneratedAnswer,
    GenerationDelta,
    build_prompt,
    extract_citations,
    strip_code_spans,
)
from rag_service.generation.parts import Attachment, Prompt, prompt_text
from rag_service.retrieval.service import BudgetState, HydratedChunk
from rag_service.settings import resolve_ai_settings

CYCLE = datetime(2026, 8, 1, tzinfo=timezone.utc)

SCREENSHOT = Attachment(
    mime_type="image/png", data=b"\x89PNG", file_name="error.png"
)


def chunk(index: int, title: str = "Handbook", page: int | None = 4) -> HydratedChunk:
    return HydratedChunk(
        chunk_id=f"chunk-{index}",
        document_id=f"doc-{index}",
        document_title=title,
        page_number=page,
        chunk_index=index,
        content_text=f"Policy text number {index}.",
        score=1.0 - index / 10,
        vector_point_id=f"point-{index}",
    )


class ScriptedGenerator:
    """Streams a fixed answer in pieces, so the streaming assertions are real."""

    def __init__(self, answer: str = "The limit is 500 [1].", pieces: int = 4) -> None:
        self.answer = answer
        self.pieces = pieces
        self.calls: list[tuple[str, str]] = []
        self.block: asyncio.Event | None = None

    async def stream(self, prompt: Prompt, model: str, max_output_tokens: int):
        self.calls.append((prompt_text(prompt), model))

        size = max(1, len(self.answer) // self.pieces)
        for start in range(0, len(self.answer), size):
            if self.block is not None:
                await self.block.wait()
            yield GenerationDelta(text=self.answer[start : start + size])

        yield GenerationDelta(done=True, prompt_tokens=800, completion_tokens=40)


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


@pytest.fixture
def generator(ledger, quota):
    return CoRagGenerator(ScriptedGenerator(), ledger, quota)


async def run(generator, chunks, settings, budget, **kwargs):
    deltas, answer = [], None

    async for item in generator.stream_answer(
        kwargs.pop("query", "what is the limit?"),
        chunks,
        settings,
        budget=budget,
        purpose=kwargs.pop("purpose", "CHAT_ANSWER"),
        retrieved_chunk_ids=[entry.chunk_id for entry in chunks],
        **kwargs,
    ):
        if isinstance(item, GeneratedAnswer):
            answer = item
        else:
            deltas.append(item)

    # Asserted, not assumed. Every caller dereferences `answer`, so a stream
    # that ended without a `GeneratedAnswer` should fail HERE — naming the
    # cause — rather than as an `AttributeError` on None in each test.
    assert answer is not None, "the stream ended without a GeneratedAnswer"

    return deltas, answer


class TestStreaming:
    async def test_tokens_arrive_INCREMENTALLY(self, generator, settings, budget):
        # The product requirement. One final chunk would satisfy every other
        # assertion in this file and would not be the product.
        deltas, _ = await run(generator, [chunk(1)], settings, budget)

        assert len(deltas) > 1

    async def test_the_answer_is_the_concatenation_of_the_deltas(
        self, generator, settings, budget
    ):
        # A caller that forwarded the tokens must be able to trust that the
        # persisted content matches what the user watched appear.
        deltas, answer = await run(generator, [chunk(1)], settings, budget)

        assert answer.content == "".join(delta.text for delta in deltas)


class TestGrounding:
    async def test_an_empty_retrieval_NEVER_reaches_the_model(
        self, ledger, quota, settings, budget
    ):
        # An enterprise support bot inventing a policy is worse
        # than one that escalates — and the notebook app this came from did the
        # opposite.
        scripted = ScriptedGenerator()
        generator = CoRagGenerator(scripted, ledger, quota)

        _, answer = await run(generator, [], settings, budget)

        assert answer.status == "DOC_MISSING"
        assert answer.content == DOC_MISSING_WITH_HANDOFF
        assert scripted.calls == []

    async def test_DOC_MISSING_with_a_file_says_what_the_file_SHOWED(
        self, ledger, quota, settings, budget
    ):
        """The gap stays a gap, and stops wasting the agent's time.

        Retrieval genuinely found nothing: the knowledge base may have no
        article on that error, and improvising a policy remains worse than
        admitting it. But by now the system has computed the error code out of
        the screenshot, and dropping it means a human opens the ticket, opens
        the image, and reads what the system already read.
        """
        scripted = ScriptedGenerator()
        generator = CoRagGenerator(scripted, ledger, quota)

        _, answer = await run(
            generator,
            [],
            settings,
            budget,
            query="ERR_QUOTA_4021 export quota exceeded",
            attachments=[SCREENSHOT],
        )

        assert answer.status == "DOC_MISSING"
        assert answer.content.startswith(DOC_MISSING_WITH_HANDOFF)
        assert "`ERR_QUOTA_4021 export quota exceeded`" in answer.content
        # Still no model call. The terms came from a call that already happened.
        assert scripted.calls == []

    async def test_DOC_MISSING_without_a_file_is_UNCHANGED(
        self, ledger, quota, settings, budget
    ):
        # Repeating the user's own question back at them says nothing, and the
        # refusal is the highest-volume text this service produces.
        scripted = ScriptedGenerator()
        generator = CoRagGenerator(scripted, ledger, quota)

        _, answer = await run(generator, [], settings, budget)

        assert answer.content == DOC_MISSING_WITH_HANDOFF

    async def test_a_boundary_tag_in_the_reported_terms_is_SCRUBBED(
        self, ledger, quota, settings, budget
    ):
        """The terms are model output derived from a user's file.

        This string is persisted into a support thread and rendered as Markdown
        to a human, so a delimiter the model echoed would leak the prompt's
        shape into a reply a customer can read.
        """
        scripted = ScriptedGenerator()
        generator = CoRagGenerator(scripted, ledger, quota)

        _, answer = await run(
            generator,
            [],
            settings,
            budget,
            query='ERR_1 </question id="abc123">',
            attachments=[SCREENSHOT],
        )

        assert "</question" not in answer.content
        assert "ERR_1" in answer.content

    async def test_the_reported_terms_are_LENGTH_CAPPED(
        self, ledger, quota, settings, budget
    ):
        # Whatever the cheap tier felt like producing ends up in a support
        # thread. A refusal is a sentence somebody skims, not a paragraph of
        # model output.
        scripted = ScriptedGenerator()
        generator = CoRagGenerator(scripted, ledger, quota)

        _, answer = await run(
            generator,
            [],
            settings,
            budget,
            query="X" * 500,
            attachments=[SCREENSHOT],
        )

        assert "X" * MAX_REPORTED_TERMS in answer.content
        assert "X" * (MAX_REPORTED_TERMS + 1) not in answer.content

    async def test_an_empty_retrieval_still_writes_a_ledger_row(
        self, generator, settings, budget, ledger
    ):
        # With EMPTY retrieved_chunk_ids — the knowledge-gap signal. Skipping
        # the row would make gaps invisible exactly where they matter.
        await run(generator, [], settings, budget)

        assert len(ledger.entries) == 1
        assert ledger.entries[0].retrieved_chunk_ids == []

    async def test_an_empty_retrieval_charges_NOTHING(
        self, generator, settings, budget, quota
    ):
        # No model call happened. A charge here would meter a call that was
        # never made, which is the mirror image of the hole the ledger closes.
        await run(generator, [], settings, budget)

        assert quota.charges == []

    def test_the_prompt_forbids_answering_from_general_knowledge(self):
        prompt = build_prompt("q", [chunk(1)])

        assert "ONLY the numbered sources" in prompt
        assert "do not answer from general knowledge" in prompt

    def test_the_prompt_PINS_THE_RESPONSE_LANGUAGE(self):
        # The rest of the pipeline is multilingual by design —
        # the greeting regex, `canned_reply`, and the `'simple'` FTS
        # configuration — and this prompt was the one place that stopped.
        #
        # The failure it prevents is quiet: a Vietnamese question against an
        # English handbook retrieves correctly, generates successfully, cites a
        # real source, and comes back in English. Every metric reads green and
        # the user gives up.
        prompt = build_prompt("q", [chunk(1)])

        assert "same language as the question" in prompt

    def test_the_prompt_STATES_THE_OUTPUT_FORMAT(self):
        # Markdown already came out of this prompt without being
        # asked for, because the training data is full of it — which is a
        # property of the MODEL, not of the system. A model version change, a
        # tier change or an edit to the grounding rules can silently produce a
        # wall of plain text into a renderer expecting structure, and nothing
        # fails. Stating it is what makes it testable at all.
        prompt = build_prompt("q", [chunk(1)])

        assert "GitHub-flavoured Markdown" in prompt

    def test_the_prompt_forbids_the_two_formats_that_BREAK_THE_RENDERER(self):
        # Both are defensive rather than stylistic, and both are things models
        # do unprompted when asked for markdown:
        #
        #   - a heading inside a chat bubble that already sits under a page
        #     heading breaks the document outline and is enormous in most themes
        #   - fencing the WHOLE answer turns the entire reply into an unrendered
        #     grey block
        prompt = build_prompt("q", [chunk(1)])

        assert "Do not use headings" in prompt
        assert "Never wrap the whole answer in a code fence" in prompt

    def test_the_prompt_asks_for_BACKTICKS_around_exact_values(self):
        # The one clause that improves usefulness rather than appearance. A
        # policy number or an error code in prose gets reformatted by the model;
        # inside backticks it survives verbatim — which is what a user copies.
        prompt = build_prompt("q", [chunk(1)])

        assert "`code` for exact values" in prompt

    def test_the_prompt_carries_the_title_and_page_a_citation_needs(self):
        prompt = build_prompt("q", [chunk(1, title="Expense Policy", page=7)])

        assert "Expense Policy" in prompt
        assert "page 7" in prompt


class TestCitations:
    def test_cited_is_a_SUBSET_of_retrieved(self):
        # What makes `UNCITED` mean anything (RDM Table 27). A citation list
        # built from everything retrieved would claim the model used all five
        # sources when it used one, and the flag that finds context-polluting
        # documents would never fire.
        chunks = [chunk(1), chunk(2), chunk(3)]

        citations = extract_citations("Per [2], the limit is 500.", chunks)

        assert [citation.chunk_id for citation in citations] == ["chunk-2"]

    def test_an_INVENTED_marker_is_ignored_rather_than_crashing(self):
        # A model that writes [9] over three sources must not produce an
        # IndexError, and must not silently cite the wrong document.
        chunks = [chunk(1), chunk(2)]

        citations = extract_citations("See [9] and [1].", chunks)

        assert [citation.chunk_id for citation in citations] == ["chunk-1"]

    def test_a_repeated_marker_cites_once(self):
        chunks = [chunk(1)]

        citations = extract_citations("[1] says X, and [1] also says Y.", chunks)

        assert len(citations) == 1

    def test_a_marker_inside_an_INLINE_CODE_SPAN_is_not_a_citation(self):
        # The collision the markdown contract creates. Asking for
        # markdown means more code in answers, and `items[2]` parses as a
        # citation of source 2 under the `[n]` pattern.
        #
        # It is bounds-checked, so it cannot crash. It can only attribute the
        # answer to a document the model never used — which is WORSE than an
        # uncited answer: an operator reading the trail sees a source that was
        # never consulted, and `UNCITED` stops meaning what it says.
        chunks = [chunk(1), chunk(2), chunk(3)]

        citations = extract_citations(
            "Read the first entry with `items[2]`, as described in [1].",
            chunks,
        )

        assert [citation.chunk_id for citation in citations] == ["chunk-1"]

    def test_a_marker_inside_a_FENCED_BLOCK_is_not_a_citation(self):
        chunks = [chunk(1), chunk(2), chunk(3)]

        answer = (
            "Use the second element, per [1]:\n"
            "```python\n"
            "value = items[2]\n"
            "other = rows[3]\n"
            "```\n"
        )

        citations = extract_citations(answer, chunks)

        assert [citation.chunk_id for citation in citations] == ["chunk-1"]

    def test_REAL_citations_still_resolve_after_stripping(self):
        # The guard that the fix did not eat what it was protecting. A stripper
        # that blanked too much would silently produce uncited answers, which
        # looks like a model problem and is not one.
        chunks = [chunk(1), chunk(2), chunk(3)]

        answer = (
            "Per [1] the limit is 500, and [3] covers the exception.\n"
            "```\n"
            "example = rows[2]\n"
            "```\n"
            "See also [3]."
        )

        citations = extract_citations(answer, chunks)

        assert [citation.chunk_id for citation in citations] == [
            "chunk-1",
            "chunk-3",
        ]

    def test_an_UNTERMINATED_fence_does_not_swallow_earlier_citations(self):
        # What a truncated or mid-stream answer looks like. Everything after the
        # opening fence is correctly treated as code — a truncated code block is
        # still a code block — but the prose BEFORE it must survive, or a
        # cut-off answer would lose every citation it had already made.
        chunks = [chunk(1), chunk(2)]

        answer = "Per [1], run:\n```bash\nrun --flag items[2]"

        citations = extract_citations(answer, chunks)

        assert [citation.chunk_id for citation in citations] == ["chunk-1"]


class TestCodeSpanStripping:
    """The stripper itself, including its cost.

    Its input is a MODEL's output: untrusted, occasionally pathological, and
    reachable by anyone who can upload a document. The obvious regexes for both
    halves are super-linear on backtracking, and this codebase has already paid
    for that once -- see "bounded time on pathological input" in
    ingestion-service's ``document-parser.service.spec.ts``.
    """

    def test_the_result_is_the_SAME_LENGTH_as_the_input(self):
        # Blanked rather than removed, so citation offsets in the stripped copy
        # line up with the original. Nothing depends on that yet; it is what
        # makes this safe to reuse for offset work later without a second pass.
        for text in ("a `b` c", "```\nx\n```", "``a`b`` c", "plain"):
            assert len(strip_code_spans(text)) == len(text)

    def test_PROSE_IS_UNTOUCHED(self):
        assert strip_code_spans("Per [1], the limit is 500.") == (
            "Per [1], the limit is 500."
        )

    def test_a_PATHOLOGICAL_input_is_stripped_in_bounded_time(self):
        # The regression guard for the class of bug, not for one expression.
        # Measured linear across 10k-80k on every shape below; the ceiling is
        # deliberately loose so this fails on a super-linear rewrite rather than
        # on a slow CI box.
        import time

        for text in (
            "`" * 200_000,
            "```\n" + ("x[2] " * 40_000),
            "`a` " * 50_000,
            "``a`b" * 40_000,
        ):
            started = time.perf_counter()
            strip_code_spans(text)

            assert time.perf_counter() - started < 2.0


class TestMetering:
    async def test_charges_before_recording(
        self, generator, settings, budget, quota, ledger
    ):
        await run(generator, [chunk(1)], settings, budget)

        assert quota.charges
        assert quota.charges[0] > 0
        assert len(ledger.entries) == 1

    async def test_records_the_model_the_settings_layer_resolved(
        self, generator, settings, budget, ledger
    ):
        await run(generator, [chunk(1)], settings, budget)

        assert ledger.entries[0].model_name == settings.generation_model

    async def test_records_both_retrieved_and_cited_ids(
        self, generator, settings, budget, ledger
    ):
        chunks = [chunk(1), chunk(2)]

        await run(generator, chunks, settings, budget)

        entry = ledger.entries[0]
        assert set(entry.retrieved_chunk_ids) == {"chunk-1", "chunk-2"}
        assert set(entry.cited_chunk_ids) <= set(entry.retrieved_chunk_ids)

    async def test_attributes_spend_to_the_ticket_when_there_is_one(
        self, generator, settings, budget, ledger
    ):
        await run(generator, [chunk(1)], settings, budget, ticket_id="ticket-1")

        assert ledger.entries[0].ticket_id == "ticket-1"


class TestCancellation:
    async def test_a_cancelled_stream_STILL_records_and_STILL_charges(
        self, ledger, quota, settings, budget
    ):
        # And the reason it is called out: with
        # `asyncio.create_task`, cancelling the request cancels its children —
        # so the ledger write is exactly what dies, and the metering hole hides
        # inside the metering design.
        scripted = ScriptedGenerator(answer="a" * 200, pieces=20)
        scripted.block = asyncio.Event()
        scripted.block.set()

        generator = CoRagGenerator(scripted, ledger, quota)

        async def consume():
            async for _item in generator.stream_answer(
                "q",
                [chunk(1)],
                settings,
                budget=budget,
                purpose="CHAT_ANSWER",
                retrieved_chunk_ids=["chunk-1"],
            ):
                # Blocks after the first delta, so the cancellation lands
                # mid-generation rather than after it finished.
                assert scripted.block is not None
                scripted.block.clear()
                await asyncio.sleep(5)

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.05)
        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await task

        # The write is scheduled rather than awaited — it cannot be awaited
        # during GeneratorExit — so the loop needs a turn to run it. That is
        # the real behaviour, not a test artifact: the row lands just after the
        # request ends, which is why `LedgerClient.drain()` exists.
        await asyncio.sleep(0.05)

        assert len(ledger.entries) == 1
        assert ledger.entries[0].status == "CANCELLED"
        # Partial generation is real spend.
        assert quota.charges
        assert quota.charges[0] > 0


class TestTruncationIsDiagnosable:
    """`MAX_TOKENS` must leave a trace.

    Truncation and a badly-answered question produce the SAME downstream
    symptom: the JSON is cut off mid-object, `_json_object` returns `{}`, and
    the caller renders "not available". One is fixed by raising a constant and
    the other is a model problem, and nothing distinguished them.
    """

    class FakeCandidate:
        def __init__(self, reason):
            self.finish_reason = reason

    class FakeResponse:
        def __init__(self, text, reason=None, usage=None):
            self.text = text
            self.candidates = (
                [TestTruncationIsDiagnosable.FakeCandidate(reason)] if reason else []
            )
            self.usage_metadata = usage

    def _generator(self, responses):
        """A `GeminiGenerator` whose provider call is replaced.

        Constructed WITHOUT `__init__`, because that builds a real
        `genai.Client` and would need an API key to test a log line.
        """
        from rag_service.generation.gemini import GeminiGenerator

        generator = GeminiGenerator.__new__(GeminiGenerator)

        class FakeModels:
            async def generate_content_stream(self, **kwargs):
                async def iterate():
                    for response in responses:
                        yield response

                return iterate()

        class FakeAio:
            models = FakeModels()

        class FakeClient:
            aio = FakeAio()

        # The provider client, replaced. Structural rather than a `genai.Client`
        # — building a real one needs an API key to test a log line.
        generator._client = FakeClient()  # type: ignore[bad-assignment]

        return generator

    async def _drain(self, generator):
        return [delta async for delta in generator.stream("prompt", "some-model", 32)]

    async def test_a_MAX_TOKENS_finish_is_logged_at_WARNING(self, caplog):
        generator = self._generator(
            [self.FakeResponse('{"summary": "cut off mid-', reason="MAX_TOKENS")]
        )

        with caplog.at_level(logging.WARNING, logger="rag_service.generation.gemini"):
            await self._drain(generator)

        # `getMessage()` rather than `.message`: the log call uses %-style
        # lazy formatting, so the raw template is what is stored.
        assert any(
            "max_output_tokens" in record.getMessage() and record.levelname == "WARNING"
            for record in caplog.records
        )

    async def test_a_NORMAL_finish_logs_NOTHING(self, caplog):
        # A warning on every successful generation is a warning nobody reads,
        # which would cost the signal this exists to create.
        generator = self._generator([self.FakeResponse("all done", reason="STOP")])

        with caplog.at_level(logging.WARNING, logger="rag_service.generation.gemini"):
            await self._drain(generator)

        assert caplog.records == []

    async def test_still_YIELDS_the_text_and_the_done_frame(self, caplog):
        # The return shape is unchanged on purpose: the empty/short result is
        # still the right outcome, and this is only about being able to find
        # out why.
        generator = self._generator([self.FakeResponse("partial", reason="MAX_TOKENS")])

        deltas = await self._drain(generator)

        assert deltas[0].text == "partial"
        assert deltas[-1].done is True

    async def test_an_UNREADABLE_finish_reason_does_not_break_generation(self):
        # Diagnostics must never be able to fail the thing they observe. A
        # provider SDK that changes the shape of `candidates` costs a log line.
        class Weird:
            @property
            def candidates(self):
                raise RuntimeError("shape changed")

            text = "still fine"
            usage_metadata = None

        generator = self._generator([Weird()])

        deltas = await self._drain(generator)

        assert deltas[-1].done is True


class TestJsonExtraction:
    r"""The greedy regex, and what it silently cost.

    `re.search(r"\{.*\}", text, re.DOTALL)` spans from the FIRST opening brace
    to the LAST one in the response. One object: correct. Anything else — prose
    containing a brace, an example object before the real one, a trailing
    sentence with a brace in it — and the captured span is not valid JSON, so
    `json.loads` fails and the caller gets `{}`.

    The outcome is degraded-but-safe, which is why it survived: it arrives as
    "summary not available" with a perfectly good object sitting inside the text
    and nothing in the logs saying so.

    Fixed AFTER the eval harness existed, so the
    change could be shown not to regress anything.
    """

    def test_TWO_objects_takes_the_FIRST_rather_than_failing(self):
        from rag_service.generation.copilot import _json_object

        # The exact regression: greedy matching spans `{"a"} … {"b"}` and
        # parses neither.
        assert _json_object('{"summary": "a"} {"summary": "b"}') == {"summary": "a"}

    def test_a_BRACE_IN_THE_PROSE_before_the_JSON_no_longer_swallows_it(self):
        from rag_service.generation.copilot import _json_object

        assert _json_object('The set {a, b}. {"summary": "real"}') == {
            "summary": "real"
        }

    def test_a_BRACE_INSIDE_A_STRING_does_not_unbalance_the_span(self):
        from rag_service.generation.copilot import _json_object

        # The bug a naive depth counter introduces while fixing the greedy one:
        # a brace inside a quoted value is content, not structure.
        assert _json_object('{"detail": "use {braces} carefully"}') == {
            "detail": "use {braces} carefully"
        }

    def test_an_ESCAPED_QUOTE_does_not_end_the_string_early(self):
        from rag_service.generation.copilot import _json_object

        assert _json_object(r'{"detail": "say \"hi\" {here}"}') == {
            "detail": 'say "hi" {here}'
        }

    def test_a_FENCED_object_still_parses(self):
        from rag_service.generation.copilot import _json_object

        # The ordinary case, and the reason searching beats parsing whole:
        # models wrap JSON in fences regardless of the prompt.
        assert _json_object('```json\n{"summary": "fenced"}\n```') == {
            "summary": "fenced"
        }

    def test_TRUNCATION_still_returns_an_empty_object(self):
        from rag_service.generation.copilot import _json_object

        # Unchanged behaviour on purpose. The empty result IS right here — the
        # object genuinely is not there. `gemini.py` logs `MAX_TOKENS` so the
        # cause is findable.
        assert _json_object('```json\n{"summary":') == {}

    def test_an_ARRAY_is_not_accepted_where_an_OBJECT_was_asked_for(self):
        from rag_service.generation.copilot import _json_object

        assert _json_object("[1, 2, 3]") == {}

    def test_an_OBJECT_is_not_accepted_where_an_ARRAY_was_asked_for(self):
        from rag_service.generation.copilot import _json_array

        assert _json_array('{"a": 1}') == []

    def test_an_array_of_objects_parses_as_the_ARRAY(self):
        from rag_service.generation.copilot import _json_array

        # The shape `suggest` actually returns, and the case that makes the
        # "keep scanning past an unclosed opener" branch necessary.
        assert _json_array('Here you go: [{"title": "t"}]') == [{"title": "t"}]

    def test_the_FIRST_PARSABLE_span_wins_even_when_an_earlier_one_is_broken(self):
        from rag_service.generation.copilot import _json_object

        assert _json_object('{not json} then {"summary": "good"}') == {
            "summary": "good"
        }

    def test_empty_and_None_are_empty(self):
        from rag_service.generation.copilot import _json_array, _json_object

        assert _json_object("") == {}
        assert _json_object(None) == {}  # type: ignore[arg-type]
        assert _json_array("") == []
