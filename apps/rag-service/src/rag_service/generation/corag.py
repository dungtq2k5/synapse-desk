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

    return (
        "You are a support assistant. Answer the user's question using ONLY the "
        "numbered sources below.\n"
        "Cite the sources you use as [1], [2] and so on, inline.\n"
        "If the sources do not answer the question, say so plainly and do not "
        "answer from general knowledge — a wrong policy is worse than no "
        "answer.\n\n"
        f"SOURCES:\n{context}\n\n"
        f"QUESTION: {query}\n\nANSWER:"
    )


def extract_citations(answer: str, chunks: list[HydratedChunk]) -> list[Citation]:
    """The chunks the answer actually referenced, by their `[n]` markers.

    **A subset of what was retrieved, always** — which is what makes `UNCITED`
    mean anything (RDM Table 27). A citation list built from everything
    retrieved would say the model used all five sources when it used one, and
    the flag that finds context-polluting documents would never fire.
    """
    import re

    referenced = {
        int(marker)
        for marker in re.findall(r"\[(\d+)\]", answer)
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

        content = "".join(parts)
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
            content=text,
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

        content = "".join(parts)

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
            except (asyncio.TimeoutError, Exception):
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
        except (asyncio.TimeoutError, Exception):
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
