"""Co-RAG generation — 13-doc §4, and the two decisions that shape it.

**Co-RAG, not Self-RAG, and streaming is what decides it.** Self-RAG generates
N candidates, judges them, then picks a winner — you cannot stream an answer you
have not chosen. Co-RAG's Mode A draft is a single generation, streamable from
the first token. Tier 1 chat runs it with `max_retries = 0`: one LLM call on the
hot path. The co-pilot runs the same generator with 1-2 review passes, because an
agent absorbs the latency and gets quality in exchange.

**No-documents does not mean improvise.** `DOC_MISSING` offers the human handoff
and records the gap; it does not fall back to general knowledge (11-doc §1.6).
An enterprise support bot inventing a policy is worse than one that escalates,
and the notebook app this pipeline came from did the opposite.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol

from rag_service.enums import AiGenerationPurpose, AiGenerationStatus
from rag_service.generation.boundary import (
    boundary_instruction,
    new_nonce,
    scrub_boundary,
    wrap_question,
    wrap_sources,
)
from rag_service.generation.review import (
    REFINE_MAX_TOKENS,
    REVIEW_MAX_TOKENS,
    Review,
    ReviewVerdict,
    build_refine_prompt,
    build_review_prompt,
    parse_review,
)
from rag_service.ledger.client import GenerationEntry, LedgerClient
from rag_service.retrieval.service import BudgetState, HydratedChunk
from rag_service.settings import AiSettings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Citation:
    chunk_id: str
    document_id: str
    document_title: str
    page_number: int | None
    #: The id a citation RESOLVES THROUGH — 13-doc §4.1 test 2.
    #:
    #: Carried even though `chunk_id` would also find the row, because it is
    #: the key the two arms fuse on and the one Qdrant returns natively. A
    #: citation that could only be resolved by `chunk_id` would be resolvable
    #: from Postgres alone, and the point of the bridge is that a hit in
    #: either store leads back to the same passage.
    vector_point_id: str = ""


@dataclass
class GeneratedAnswer:
    content: str
    status: str
    citations: list[Citation] = field(default_factory=list)
    generation_id: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0


class StreamingGenerator(Protocol):
    """Generation, streamed. The unary case is this consumed to exhaustion."""

    def stream(
        self,
        prompt: str,
        model: str,
        max_output_tokens: int,
        # Unquoted despite GenerationDelta being defined below: the
        # `from __future__ import annotations` above makes every annotation lazy.
    ) -> AsyncIterator[GenerationDelta]: ...


@dataclass(frozen=True)
class GenerationDelta:
    """One frame. The final frame carries the usage; earlier ones carry text."""

    text: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    done: bool = False


#: The answer given when retrieval found nothing, PER SURFACE.
#:
#: A constant rather than a generation: paying a model to say "I don't know" is
#: spend on the one answer that needs no intelligence, and a generated version
#: would vary — sometimes hedging into a guess, which is exactly what §1.6
#: forbids.
#:
#: **Two of them, because the surfaces differ in one important way** (13-doc
#: §2.4). Tier 1 chat sits in a conversation that can be escalated, so it offers
#: the handoff. `/knowledge/ask` has no conversation and no ticket — there is
#: nothing to escalate INTO — so offering a handoff there is promising something
#: the system cannot perform, and a user who accepts the offer gets nothing.
DOC_MISSING_WITH_HANDOFF = (
    "I could not find anything in your organization's knowledge base that "
    "covers this. I can hand this over to a human colleague who can help."
)

DOC_MISSING_NO_HANDOFF = (
    "Nothing in your organization's knowledge base covers this. Try rephrasing "
    "the question, or ask a colleague who owns this area."
)

#: The surfaces that CAN escalate. Everything else gets the plain refusal.
#:
#: A set rather than a boolean argument, so adding a surface is a decision made
#: here — where the reason is written down — rather than at a call site that
#: copied whichever flag the neighbouring call used.
HANDOFF_CAPABLE_PURPOSES = frozenset({"CHAT_ANSWER_TICKET", "DRAFT"})


def doc_missing_answer(purpose: str, *, can_escalate: bool) -> str:
    """The refusal text for a surface. Never invents, never over-promises."""
    _ = purpose

    return DOC_MISSING_WITH_HANDOFF if can_escalate else DOC_MISSING_NO_HANDOFF


MAX_ANSWER_TOKENS = 1_024


def build_prompt(query: str, chunks: list[HydratedChunk]) -> str:
    """The grounding prompt.

    Each chunk is numbered so the model can cite by index, and the instruction
    to refuse rather than improvise is repeated in the prompt as well as being
    enforced by the caller. Belt and braces on purpose: the caller's check
    catches an empty retrieval, and this catches the case where chunks were
    retrieved but none of them actually answer the question — which no amount
    of retrieval logic can detect.
    """
    context = "\n\n".join(
        f'[{index + 1}] (from "{chunk.document_title}"'
        + (f", page {chunk.page_number}" if chunk.page_number else "")
        + f")\n{chunk.content_text}"
        for index, chunk in enumerate(chunks)
    )

    nonce = new_nonce()

    return (
        "You are a support assistant. Answer the user's question using ONLY the "
        "numbered sources below.\n" + boundary_instruction(nonce) +
        # 33-doc §4.3 — the boundary, stated where the grounding rules are,
        # because it is the rule that says which text the grounding rules apply
        # to. Without this line the delimiters below are decoration.
        # 17-doc §2.1 — the one confirmed prompt defect, and the highest-value
        # line available.
        #
        # Everything around this is multilingual BY DESIGN: Layer 1's greeting
        # regex covers several languages on purpose, `canned_reply` is keyed by
        # detected language, and the FTS index uses `'simple'` rather than
        # `'english'` specifically because the corpus is multilingual. The
        # generation prompt was the one place that assumption stopped.
        #
        # Without this line, a Vietnamese question against an English handbook
        # retrieves correctly — the embedding model is multilingual — and then
        # the model takes its cue from the English instruction and the English
        # sources and answers in English. Deflection fails, and no metric
        # attributes it correctly: retrieval hit, generation succeeded, citation
        # present, user gave up.
        "Answer in the same language as the question, even when the sources "
        "are in another language.\n"
        "Cite the sources you use as [1], [2] and so on, inline.\n"
        "If the sources do not answer the question, say so plainly and do not "
        "answer from general knowledge — a wrong policy is worse than no "
        "answer.\n"
        # 21-doc §1.2 — the output CONTRACT.
        #
        # Markdown already came out of this prompt without being asked for,
        # because the training data is full of it. That is a property of the
        # MODEL, not of the system: a model version change, a tier change
        # (FAST -> QUALITY) or an edit to the lines above can silently produce a
        # wall of plain text into a renderer expecting structure, and nothing
        # fails. Stating it makes it a contract that can be tested.
        #
        # Kept short on purpose — every instruction here competes with the
        # grounding rules above for attention, and those matter more.
        #
        # Three of these clauses are DEFENSIVE rather than stylistic:
        #
        #   - No headings: the answer renders inside a chat bubble that already
        #     sits under a page heading, so an <h1> breaks the document outline
        #     and is enormous in most themes.
        #   - Never fence the whole answer: models asked for markdown do this
        #     surprisingly often, and it turns the entire reply into an
        #     unrendered grey block.
        #   - Backticks for exact values is the one that improves USEFULNESS
        #     rather than appearance. A policy number or error code in prose
        #     gets reformatted by the model; inside backticks it survives
        #     verbatim, which is what a user copies.
        "Format the answer as GitHub-flavoured Markdown. Use bullet lists for "
        "steps or options, `code` for exact values, commands and error "
        "strings, and **bold** for the single most important fact. Do not use "
        "headings — the answer is rendered inside an existing page. Never wrap "
        "the whole answer in a code fence.\n\n"
        f"{wrap_sources(context, nonce)}\n\n"
        f"{wrap_question(query, nonce)}\n\nANSWER:"
    )


def strip_code_spans(markdown: str) -> str:
    """Blanks fenced blocks and inline code, preserving everything else.

    **The collision the markdown contract creates** — 21-doc §1.3. Asking for
    markdown means more code in answers, and a code sample containing
    ``array[0]`` or ``items[2]`` parses as a citation of source 2 under the
    ``\\[(\\d+)\\]`` pattern below. It is bounds-checked so it cannot crash — it
    can only attribute an answer to a document the model never used, which is
    worse than an uncited answer: an operator reading the trail sees a source
    that was never consulted, and `UNCITED` stops meaning what it says.

    Replaced with spaces rather than removed, so the result has the same length
    as the input. Nothing depends on that today, and it makes this safe to use
    for offset-based work later without a second pass.

    Fences are handled before inline spans because an unmatched backtick inside
    a fenced block would otherwise open a spurious inline span and swallow the
    prose after it.

    **Written as a linear scan rather than a regex, deliberately.** The natural
    expressions for both halves — ``^```.*?^```$`` for fences and
    ``(`+)(?:(?!\\1).)*\\1`` for inline spans — are super-linear on
    backtracking, and this input is a MODEL's output: untrusted, occasionally
    pathological, and reachable by anyone who can upload a document. This
    codebase has already paid for that lesson twice (`stripHtmlTags`'s measured
    quadratic blowup, `HEADING_PATTERN`'s standing FIXME); a third is not worth
    the four lines it would save.
    """
    lines = markdown.split("\n")
    in_fence = False
    fence_marker = ""

    for index, line in enumerate(lines):
        stripped = line.lstrip()

        if not in_fence:
            marker = _fence_marker(stripped)
            if marker:
                in_fence, fence_marker = True, marker
                lines[index] = " " * len(line)
                continue
        else:
            # A closing fence is the same marker with nothing after it. An
            # answer that ends mid-fence simply never closes, and everything
            # after it stays blanked — which is correct: a truncated code block
            # is still a code block, and its contents are still not prose.
            lines[index] = " " * len(line)
            if stripped.rstrip() == fence_marker:
                in_fence, fence_marker = False, ""
            continue

        lines[index] = _blank_inline_spans(line)

    return "\n".join(lines)


def _fence_marker(stripped_line: str) -> str:
    """The ``` or ~~~ opening a fence, or empty when the line opens none."""
    for char in ("`", "~"):
        run = len(stripped_line) - len(stripped_line.lstrip(char))
        if run >= 3:
            return char * run

    return ""


def _backtick_runs(line: str) -> list[tuple[int, int]]:
    """Every maximal run of backticks, as `(start, length)`. One pass."""
    runs: list[tuple[int, int]] = []
    index = 0

    while index < len(line):
        if line[index] != "`":
            index += 1
            continue

        start = index
        while index < len(line) and line[index] == "`":
            index += 1
        runs.append((start, index - start))

    return runs


def _blank_inline_spans(line: str) -> str:
    """Replaces `code` runs with spaces, leaving an unterminated one alone.

    A span opens at a run of N backticks and closes at the next run of exactly
    N — CommonMark's rule, and the reason ``` ``a`b`` ``` is one span rather
    than two.

    **An unmatched opener stays as prose**, which is both what CommonMark does
    and what a mid-stream answer needs: a half-written span is the normal case
    while tokens are still arriving, not an error.
    """
    runs = _backtick_runs(line)
    out = list(line)
    index = 0

    while index < len(runs):
        start, run = runs[index]
        closer = next(
            (other for other in range(index + 1, len(runs)) if runs[other][1] == run),
            None,
        )

        if closer is None:
            index += 1
            continue

        close_start, close_run = runs[closer]
        for position in range(start, close_start + close_run):
            out[position] = " "

        index = closer + 1

    return "".join(out)


def extract_citations(answer: str, chunks: list[HydratedChunk]) -> list[Citation]:
    """The chunks the answer actually referenced, by their `[n]` markers.

    **A subset of what was retrieved, always** — which is what makes `UNCITED`
    mean anything (RDM Table 27). A citation list built from everything
    retrieved would say the model used all five sources when it used one, and
    the flag that finds context-polluting documents would never fire.

    **Extracted from the PROSE only** (21-doc §1.3): code spans are blanked
    first, so `items[2]` in a code sample is not read as a citation. The
    original answer is what gets rendered and stored — only the citation scan
    sees the stripped copy.
    """
    import re

    prose = strip_code_spans(answer)

    referenced = {
        int(marker)
        for marker in re.findall(r"\[(\d+)\]", prose)
        # Bounds-checked: a model that invents `[9]` over five sources must not
        # produce an IndexError, and must not silently cite the wrong document.
        if marker.isdigit() and 1 <= int(marker) <= len(chunks)
    }

    return [
        Citation(
            chunk_id=chunks[index - 1].chunk_id,
            document_id=chunks[index - 1].document_id,
            document_title=chunks[index - 1].document_title,
            page_number=chunks[index - 1].page_number,
            vector_point_id=chunks[index - 1].vector_point_id,
        )
        for index in sorted(referenced)
    ]


class CoRagGenerator:
    def __init__(
        self,
        generator: StreamingGenerator,
        ledger: LedgerClient,
        quota,
    ) -> None:
        self._generator = generator
        self._ledger = ledger
        self._quota = quota
        self._cancelled_writes: set[asyncio.Task] = set()
        self._last_generation_id: str = ""

    async def stream_answer(
        self,
        query: str,
        chunks: list[HydratedChunk],
        settings: AiSettings,
        *,
        budget: BudgetState,
        purpose: str,
        retrieved_chunk_ids: list[str],
        user_id: str | None = None,
        ticket_id: str | None = None,
        can_escalate: bool = True,
    ) -> AsyncIterator[GenerationDelta | GeneratedAnswer]:
        """Yields token deltas, then ONE `GeneratedAnswer` as the last item.

        Two terminal behaviours matter more than the streaming itself:

        **An empty retrieval never reaches the model.** It yields the canned
        `DOC_MISSING` answer and still writes a ledger row — with EMPTY
        `retrieved_chunk_ids`, which is the knowledge-gap signal (13-doc §4.1
        test 4). Skipping the row would make gaps invisible precisely where
        they matter.

        **A cancelled stream still charges and still records.** Partial
        generation is real spend, and the natural implementation is the broken
        one: with `asyncio.create_task`, cancelling the request cancels its
        children, so the ledger write is exactly what dies — the metering hole
        hides inside the metering design.
        """
        if not chunks:
            answer = GeneratedAnswer(
                content=doc_missing_answer(purpose, can_escalate=can_escalate),
                status="DOC_MISSING",
                citations=[],
            )
            answer.generation_id = await self._record(
                answer,
                settings,
                budget,
                purpose=purpose,
                retrieved_chunk_ids=[],
                user_id=user_id,
                ticket_id=ticket_id,
                # No model call happened, so no tokens were consumed. Recorded
                # anyway: the row IS the gap signal, and a gap that costs
                # nothing still needs to be findable.
                charge=False,
            )
            yield answer
            return

        prompt = build_prompt(query, chunks)
        parts: list[str] = []
        prompt_tokens = 0
        completion_tokens = 0
        started_at = time.monotonic()
        status = "DOC_ANSWER"

        try:
            async for delta in self._generator.stream(
                prompt, settings.generation_model, MAX_ANSWER_TOKENS
            ):
                if delta.text:
                    parts.append(delta.text)
                    yield delta
                if delta.done:
                    prompt_tokens = delta.prompt_tokens
                    completion_tokens = delta.completion_tokens
        except (asyncio.CancelledError, GeneratorExit):
            # The user closed the tab. The tokens produced so far were still
            # generated and still cost money.
            #
            # **Both exceptions, and the second one is the trap.** When the
            # consuming task is cancelled while suspended at a `yield`, Python
            # does not throw CancelledError in here — it throws GeneratorExit
            # during `aclose()`. Catching only CancelledError produces a
            # handler that looks correct, passes a naive test, and never runs
            # in production.
            #
            # **Nothing is awaited in this handler**, which is the other half:
            # awaiting during GeneratorExit raises "async generator ignored
            # GeneratorExit" and loses the write anyway. The charge and the row
            # are scheduled as an INDEPENDENT task — `create_task` does not
            # inherit the canceller's fate — and the exception is re-raised
            # immediately, because swallowing it would leave the caller's task
            # believing it completed normally.
            answer = GeneratedAnswer(
                content="".join(parts),
                status=AiGenerationStatus.CANCELLED,
                citations=extract_citations("".join(parts), chunks),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens or _estimate(parts),
            )
            self._schedule_cancelled_record(
                answer,
                settings,
                budget,
                purpose=purpose,
                retrieved_chunk_ids=retrieved_chunk_ids,
                user_id=user_id,
                ticket_id=ticket_id,
                latency_ms=int((time.monotonic() - started_at) * 1000),
            )
            raise

        content = scrub_boundary("".join(parts))
        answer = GeneratedAnswer(
            content=content,
            status=status,
            citations=extract_citations(content, chunks),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )
        answer.generation_id = await self._record(
            answer,
            settings,
            budget,
            purpose=purpose,
            retrieved_chunk_ids=retrieved_chunk_ids,
            user_id=user_id,
            ticket_id=ticket_id,
            latency_ms=int((time.monotonic() - started_at) * 1000),
        )

        yield answer

    async def generate(self, *args, **kwargs) -> GeneratedAnswer:
        """The unary form — the stream consumed to exhaustion.

        One implementation rather than two, so the streamed path and the
        co-pilot path cannot diverge in what they record, what they charge or
        how they treat an empty retrieval.
        """
        answer: GeneratedAnswer | None = None

        async for item in self.stream_answer(*args, **kwargs):
            if isinstance(item, GeneratedAnswer):
                answer = item

        assert answer is not None
        return answer

    async def generate_reviewed(
        self,
        query: str,
        chunks: list[HydratedChunk],
        settings: AiSettings,
        *,
        budget: BudgetState,
        purpose: str,
        retrieved_chunk_ids: list[str],
        max_retries: int,
        user_id: str | None = None,
        ticket_id: str | None = None,
    ) -> GeneratedAnswer:
        """Draft, review, refine — 13-doc §4.2, the co-pilot's differentiator.

        The same generator Tier 1 chat uses, with review passes on top. Chat
        runs this with `max_retries = 0`, which makes it exactly `generate()` —
        one code path, so the streamed answer and the reviewed draft cannot
        drift apart in what they record or how they treat an empty retrieval.

        **Bounded by the retry budget, not by the reviewer.** A reviewer that
        never says COMPLETE — because the sources genuinely do not answer the
        question — would otherwise spend until the cap stopped it.

        **Every pass is metered.** Three generations is three ledger rows and
        three charges; counting only the last one is the metering hole that
        would be widest exactly here, where one request makes the most calls.
        """
        answer = await self.generate(
            query,
            chunks,
            settings,
            budget=budget,
            purpose=purpose,
            retrieved_chunk_ids=retrieved_chunk_ids,
            user_id=user_id,
            ticket_id=ticket_id,
        )

        # An empty retrieval never gets reviewed. There is nothing to review
        # against — the sources are the yardstick — and paying a model to
        # confirm that a canned refusal is a canned refusal is spend with no
        # possible finding.
        if answer.status == "DOC_MISSING" or not chunks:
            return answer

        verdict = ReviewVerdict.COMPLETE

        for attempt in range(max(0, max_retries)):
            review = await self._review(
                query, answer, chunks, settings, budget, user_id, ticket_id
            )
            verdict = review.verdict

            if verdict is ReviewVerdict.COMPLETE:
                break

            logger.debug(
                "Review pass %d returned %s; refining", attempt + 1, verdict.value
            )
            answer = await self._refine(
                query,
                answer,
                review.critique,
                chunks,
                settings,
                budget,
                purpose,
                retrieved_chunk_ids,
                user_id,
                ticket_id,
            )

        return self._finalize(answer, verdict, chunks)

    def _finalize(
        self,
        answer: GeneratedAnswer,
        verdict: ReviewVerdict,
        chunks: list[HydratedChunk],
    ) -> GeneratedAnswer:
        return _apply_review_result(answer, verdict, chunks)

    async def _review(
        self,
        query: str,
        answer: GeneratedAnswer,
        chunks: list[HydratedChunk],
        settings: AiSettings,
        budget: BudgetState,
        user_id: str | None,
        ticket_id: str | None,
    ) -> Review:
        """One review pass, on the CHEAP model and ledgered as REVIEW.

        The cheap tier because judging "is this grounded in these passages" is
        a comparison rather than a composition, and scaling it with the tier
        would multiply a premium tenant's bill on the pass least likely to
        benefit (doc 15 §2.2's reasoning, applied to a third volume call).
        """
        text = await self._one_pass(
            build_review_prompt(query, answer.content, chunks),
            settings.cheap_model,
            REVIEW_MAX_TOKENS,
            budget=budget,
            purpose=AiGenerationPurpose.REVIEW,
            user_id=user_id,
            ticket_id=ticket_id,
        )

        # A failed review is not a failed draft. Defaulting to COMPLETE stops
        # one flaky model from doubling the bill on every request, and the
        # draft still reaches a human before it reaches a customer.
        return parse_review(text or "")

    async def _refine(
        self,
        query: str,
        answer: GeneratedAnswer,
        critique: str,
        chunks: list[HydratedChunk],
        settings: AiSettings,
        budget: BudgetState,
        purpose: str,
        retrieved_chunk_ids: list[str],
        user_id: str | None,
        ticket_id: str | None,
    ) -> GeneratedAnswer:
        """One refine pass, on the GENERATION model and ledgered as the surface.

        Recorded under the caller's own purpose (DRAFT, CHAT_ANSWER) rather
        than a `REFINE` purpose, because it IS a draft — the acceptance loop
        needs the last one to carry the content an agent will send, and a
        distinct purpose would leave the draft the agent actually sees
        unattributed to the surface that produced it.
        """
        text = await self._one_pass(
            build_refine_prompt(query, answer.content, critique, chunks),
            settings.generation_model,
            REFINE_MAX_TOKENS,
            budget=budget,
            purpose=purpose,
            user_id=user_id,
            ticket_id=ticket_id,
            content_is_draft=True,
            retrieved_chunk_ids=retrieved_chunk_ids,
            chunks=chunks,
        )

        if not text:
            # The refine failed. The PREVIOUS draft is still a real answer, so
            # returning it beats failing a request that has already produced
            # something usable and already been charged for.
            return answer

        return GeneratedAnswer(
            content=scrub_boundary(text),
            status=answer.status,
            citations=extract_citations(text, chunks),
            # The LATEST generation's id, so the acceptance loop compares
            # against the text the agent was actually shown.
            generation_id=self._last_generation_id or answer.generation_id,
            prompt_tokens=answer.prompt_tokens,
            completion_tokens=answer.completion_tokens,
        )

    async def _one_pass(
        self,
        prompt: str,
        model: str,
        max_output_tokens: int,
        *,
        budget: BudgetState,
        purpose: str,
        user_id: str | None,
        ticket_id: str | None,
        content_is_draft: bool = False,
        retrieved_chunk_ids: list[str] | None = None,
        chunks: list[HydratedChunk] | None = None,
    ) -> str | None:
        """Generate, CHARGE, RECORD — the same order as every other spend."""
        from rag_service.pricing import estimate_cost_micros

        started_at = time.monotonic()
        parts: list[str] = []
        prompt_tokens = 0
        completion_tokens = 0

        try:
            async for delta in self._generator.stream(prompt, model, max_output_tokens):
                if delta.text:
                    parts.append(delta.text)
                if delta.done:
                    prompt_tokens = delta.prompt_tokens
                    completion_tokens = delta.completion_tokens
        except Exception as error:
            logger.warning("%s pass failed: %s", purpose, error)
            return None

        content = scrub_boundary("".join(parts))

        await self._quota.charge(
            budget.organization_id,
            budget.cycle_start,
            estimate_cost_micros(model, prompt_tokens, completion_tokens),
        )

        entry = GenerationEntry(
            organization_id=budget.organization_id,
            user_id=user_id,
            ticket_id=ticket_id,
            purpose=purpose,
            model_name=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=int((time.monotonic() - started_at) * 1000),
            # Stored only for a DRAFT. A review verdict is two lines nobody
            # reads twice, and storing every intermediate pass would make the
            # ledger mostly prose.
            content=content if content_is_draft else None,
            retrieved_chunk_ids=retrieved_chunk_ids or [],
            cited_chunk_ids=(
                [c.chunk_id for c in extract_citations(content, chunks or [])]
                if content_is_draft
                else []
            ),
        )
        task = self._ledger.record(entry)

        if content_is_draft:
            try:
                self._last_generation_id = (
                    await asyncio.wait_for(asyncio.shield(task), timeout=2.0) or ""
                )
            # `Exception` alone. `asyncio.TimeoutError` IS the builtin
            # `TimeoutError` on 3.11+, which derives from it, so naming both
            # read as "the timeout is handled differently here" when nothing
            # distinguishes it.
            #
            # What this does NOT catch is the point: `CancelledError` derives
            # from `BaseException`, so cancellation still propagates — and this
            # method's whole `shield` dance exists to get that right.
            except Exception:
                self._last_generation_id = ""

        return content

    def _schedule_cancelled_record(self, *args, **kwargs) -> None:
        """Fires the cancellation write without awaiting anything.

        Held in `_cancelled_writes` for the same reason `LedgerClient` holds its
        tasks: a task nothing references can be garbage-collected mid-flight,
        and the write would disappear with no error anywhere — the same hole
        cancellation opens, arriving by a different route.
        """
        task = asyncio.get_running_loop().create_task(
            self._record(*args, status=AiGenerationStatus.CANCELLED, **kwargs)
        )

        self._cancelled_writes.add(task)
        task.add_done_callback(self._cancelled_writes.discard)

    async def _record(
        self,
        answer: GeneratedAnswer,
        settings: AiSettings,
        budget: BudgetState,
        *,
        purpose: str,
        retrieved_chunk_ids: list[str],
        user_id: str | None,
        ticket_id: str | None,
        latency_ms: int | None = None,
        status: str = AiGenerationStatus.SUCCESS,
        charge: bool = True,
    ) -> str:
        """CHARGE, then RECORD. Awaited, then fire-and-forget."""
        from rag_service.pricing import estimate_cost_micros

        if charge:
            await self._quota.charge(
                budget.organization_id,
                budget.cycle_start,
                estimate_cost_micros(
                    settings.generation_model,
                    answer.prompt_tokens,
                    answer.completion_tokens,
                ),
            )

        task = self._ledger.record(
            GenerationEntry(
                organization_id=budget.organization_id,
                user_id=user_id,
                ticket_id=ticket_id,
                purpose=purpose,
                model_name=settings.generation_model,
                prompt_tokens=answer.prompt_tokens,
                completion_tokens=answer.completion_tokens,
                latency_ms=latency_ms,
                status=status,
                content=answer.content,
                retrieved_chunk_ids=retrieved_chunk_ids,
                # ALWAYS a subset of what was retrieved. The difference is what
                # the model was given and chose not to use.
                cited_chunk_ids=[citation.chunk_id for citation in answer.citations],
            )
        )

        # The id is needed in the RESPONSE — it becomes `generatedFromId` when
        # an agent posts a draft-derived reply — so this one await is not
        # bookkeeping latency, it is the value the caller returns.
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=2.0) or ""
        # `Exception` alone — `asyncio.TimeoutError` is the builtin
        # `TimeoutError`, already covered. `CancelledError` is a `BaseException`
        # and deliberately still escapes.
        except Exception:
            # A missing id costs the acceptance loop for one draft. Failing the
            # request would cost the user their answer, which already cost
            # money to produce.
            return ""


def _estimate(parts: list[str]) -> int:
    """Completion tokens for a stream that never reported usage.

    Only reachable on cancellation, where the provider never sent its final
    frame. An estimate errs high rather than reporting zero — a zero-token
    cancellation meters as free, and cancellations are common enough that the
    hole would be real.
    """
    return max(1, sum(len(part) for part in parts) // 4)


def _apply_review_result(
    answer: GeneratedAnswer,
    verdict: ReviewVerdict,
    chunks: list[HydratedChunk],
) -> GeneratedAnswer:
    """Re-derives citations and DOWNGRADES a draft that stayed UNGROUNDED.

    Citations are re-extracted because a refined draft cites different sources
    from the one it replaced — carrying the old list forward would report the
    model as having used passages it no longer mentions, and `cited ⊆ retrieved`
    would still hold while being wrong.

    An UNGROUNDED draft that survived the retry budget is reported as
    `DOC_MISSING` rather than shipped as an answer. The sources did not support
    it, and saying so is what §1.6 asks for — the alternative is handing an
    agent a confident invention with a green tick on it.
    """
    return GeneratedAnswer(
        content=answer.content,
        status="DOC_MISSING" if verdict is ReviewVerdict.UNGROUNDED else answer.status,
        citations=extract_citations(answer.content, chunks),
        generation_id=answer.generation_id,
        prompt_tokens=answer.prompt_tokens,
        completion_tokens=answer.completion_tokens,
    )
