"""The gRPC server — `grpc.aio`, one servicer, wired at boot.

`grpc.aio` rather than the threaded server, and not as a style preference: every
dependency here is async (asyncpg, the Qdrant async client, redis.asyncio, the
Gemini aio client), and running them under a thread-pool server means an event
loop per request or a pool of loops nobody manages. The reranker is the one
CPU-bound step and it runs over a handful of candidates.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol

import asyncpg
import grpc
import redis.asyncio as redis

# **`_async` is UNTYPED and stays that way**, unlike its siblings below.
#
# `types-grpcio-health-checking` stubs `health`, `health_pb2` and
# `health_pb2_grpc` — it ships no `_async.pyi`, and `grpc_health` has no
# `py.typed`, so this module is invisible to a checker whatever is installed.
#
# **Do not "fix" it by importing the stubbed `health.HealthServicer` instead.**
# That is the THREADED implementation: its `set()` is synchronous and its
# `Check` blocks a thread this `grpc.aio` server does not have. The stub would
# make that swap type-check cleanly while breaking the health service at
# runtime — a green checker paying for a probe timeout, which reads as the
# process being unhealthy.
from grpc_health.v1 import _async as health_aio

# Typed, via `types-grpcio-health-checking` in `requirements-dev.txt`.
from grpc_health.v1 import health_pb2, health_pb2_grpc
from qdrant_client import AsyncQdrantClient

from rag_service.common.caller_context import MissingTenantError, require_tenant
from rag_service.common.metadata import GRPC_SERVER_OPTIONS, unpack_caller_context
from rag_service.config import Config, load_config
from rag_service.embeddings import EmbeddingClient, GeminiEmbeddingClient
from rag_service.enums import AiGenerationPurpose
from rag_service.generated.synapsedesk.ops import ops_pb2, ops_pb2_grpc
from rag_service.generated.synapsedesk.rag import rag_pb2, rag_pb2_grpc
from rag_service.generation.copilot import CopilotService
from rag_service.generation.corag import (
    CoRagGenerator,
    GeneratedAnswer,
    StreamingGenerator,
)
from rag_service.generation.gemini import GeminiGenerator
from rag_service.generation.parts import Attachment
from rag_service.ledger.client import LedgerClient
from rag_service.ledger.metered import MeteredGenerator
from rag_service.ledger.quota import QuotaCounter
from rag_service.preprocess.greeting import Intent, refusal_reply
from rag_service.preprocess.injection import InjectionGuard, LlmInjectionClassifier
from rag_service.preprocess.pipeline import (
    PreprocessPipeline,
    TextGenerator,
    Turn,
)
from rag_service.pricing import assert_pricing_table_covers
from rag_service.qdrant.collection import ensure_collection
from rag_service.retrieval.rerank import FlashRankReranker, Reranker
from rag_service.retrieval.service import BudgetState, RetrievalService
from rag_service.settings import (
    ALL_CONFIGURED_MODELS,
    AiSettingsResolver,
    with_co_rag_retries,
)

logger = logging.getLogger(__name__)


class ProviderClient(TextGenerator, StreamingGenerator, Protocol):
    """One provider client, BOTH capabilities.

    `Dependencies.generator` feeds three collaborators that want two different
    protocols — `PreprocessPipeline` calls `.generate`, `CoRagGenerator` calls
    `.stream`, and `CopilotService` calls `.generate`. Typing the field as their
    intersection is what lets a checker verify each of those hand-offs.

    It was `object`, which satisfies nothing and therefore checked nothing: a
    client missing `.stream` would have been accepted here and failed on the
    first streamed chat, at runtime, in production. `GeminiGenerator` and the
    suite's `ScriptedGenerator` both already implement both halves — this states
    the requirement they were already meeting.
    """


#: Clamped server-side no matter what the caller asks for. An unclamped limit
#: is a direct path to enormous prompts and a blown budget, and
#: the value that gets there does not have to arrive from a tenant.
MAX_SEARCH_LIMIT = 50

#: The escalation summary's grace past the cap — RDM §1.14, mirroring
#: `AT_CAP_POLICY[ESCALATION_SUMMARY].graceRatio` in `@synapsedesk/common`.
#:
#: Duplicated across the language boundary like the quota key, and bounded for
#: the same reason it exists: at the cap, ticket volume spikes, and an
#: exemption with no ceiling would let the spike spend without limit.
ESCALATION_GRACE_RATIO = 0.1


def with_http_status(status_code: int, message: str) -> str:
    """The `[http:NNN]` marker the gateway's filter reads.

    402 has no faithful gRPC code — `RESOURCE_EXHAUSTED` maps to 429 and
    legitimately so, since OTP throttling uses it to say "slow down", which is
    a different instruction from "buy more". The marker carries the intent
    across a hop that would otherwise flatten it.

    Mirrors `withHttpStatus` in `@synapsedesk/common`; the format is duplicated
    here for the same reason the quota key is.
    """
    return f"[http:{status_code}] {message}"


#: The injection refusal `Draft` aborts with.
#:
#: **`Draft` refuses by NOT returning a draft**, which is why this is an abort
#: rather than an empty `DraftResponse`. `ticket-service.generateDraft` maps
#: `content` and drops `status`, so a refused draft returned as a field would
#: reach the agent as an empty box that reads "the assistant had nothing to
#: say" — and the agent would then write the reply the injected text was
#: steering them toward, having been told nothing.
#:
#: 422 rather than 402: the request was understood and rejected on its content.
#: The marker survives both hops because `rag-client.service.ts` passes a gRPC
#: code and its details through unchanged, which is the same route the at-cap
#: 402 already takes.
DRAFT_REFUSAL = with_http_status(
    422, "This message was refused and no draft was produced"
)

#: The at-cap refusal, formed once.
#:
#: Five surfaces refuse identically — Ask, Draft, Summarize, Classify and
#: Suggest — and they must keep refusing identically: the gateway matches on
#: the `[http:402]` marker, so a message that drifted on ONE surface would turn
#: a "buy more" into a bare 500 for that surface alone, and nothing would fail
#: until a user hit exactly it. One binding is what makes that impossible.
AT_CAP_REFUSAL = with_http_status(402, "This workspace has used its AI allowance")


@dataclass
class Dependencies:
    """Everything the servicer needs, constructed once at boot.

    A dataclass rather than module-level globals, so tests build their own with
    substitutes for the two collaborators that cost money — and get the real
    Qdrant, the real Postgres and the real `tenant_scope()` for free.
    """

    qdrant: AsyncQdrantClient
    pool: asyncpg.Pool
    redis: redis.Redis
    embeddings: EmbeddingClient
    reranker: Reranker
    #: Serves BOTH the preprocessing steps and Co-RAG. One provider client
    #: rather than two, so the cheap-model calls and the answer share a
    #: connection pool and a single place where usage is read — which is why
    #: the type is the intersection of what they each need.
    generator: ProviderClient
    ledger: LedgerClient
    settings: AiSettingsResolver

    #: Prompt-injection detection.
    #:
    #: **Defaulted, and the default is the point.** A guard that every test and
    #: the eval harness had to remember to pass is a guard that is absent
    #: wherever somebody forgot, so the default is a working Layer A. The boot
    #: wiring below overrides it with one that also has Layer B.
    #:
    #: Nothing here can fail at boot: Layer B is a call to a provider whose
    #: credential the embedding client already validates at startup (
    #: run-open). An earlier design loaded a local model and needed a boot-time
    #: check; that approach was measured and rejected.
    injection: InjectionGuard = field(default_factory=InjectionGuard)

    def retrieval(self) -> RetrievalService:
        return RetrievalService(
            qdrant=self.qdrant,
            pool=self.pool,
            embeddings=self.embeddings,
            reranker=self.reranker,
            quota=QuotaCounter(self.redis),
            ledger=self.ledger,
        )


class RagServicer(rag_pb2_grpc.RagServiceServicer):
    def __init__(self, deps: Dependencies) -> None:
        self._deps = deps
        self._retrieval = deps.retrieval()
        self._preprocess = PreprocessPipeline(
            deps.generator, deps.ledger, QuotaCounter(deps.redis)
        )
        # **One guard, three surfaces**. Constructed here rather
        # than inside the pipeline because the pipeline serves `Chat` alone,
        # and `Ask` and `Draft` are two thirds of what needs defending.
        self._injection = deps.injection
        self._corag = CoRagGenerator(
            deps.generator, deps.ledger, QuotaCounter(deps.redis)
        )
        self._copilot = CopilotService(
            deps.generator,
            deps.ledger,
            QuotaCounter(deps.redis),
            # **The collaborator this class did not have**. The
            # same retriever the answering path uses, so the article sidebar is
            # scoped by the same `tenant_scope()` and cannot see further than a
            # `Chat` answer can.
            self._retrieval,
        )

    # -----------------------------------------------------------------
    # Retrieval
    # -----------------------------------------------------------------

    async def Search(
        self,
        request: rag_pb2.SearchRequest,
        context: grpc.aio.ServicerContext,
    ) -> rag_pb2.SearchResponse:
        """Retrieval with NO generation — the test seam.

        **At the cap this degrades to lexical-only rather than returning 402.**
        The FTS arm needs no embedding and therefore costs nothing, so a
        Knowledge Manager keeps their corpus diagnostics at precisely the moment
        someone is trying to work out what happened. And "degraded" has to mean
        CHEAPER, not merely relabelled — the embedding client is not called at
        all on that path.
        """
        ctx = unpack_caller_context(context.invocation_metadata())

        try:
            organization_id = require_tenant(ctx)
        except MissingTenantError as error:
            await context.abort(grpc.StatusCode.FAILED_PRECONDITION, str(error))
            raise  # unreachable: abort() never returns. See _prepare.

        settings = await self._deps.settings.settings_for(organization_id)

        query = (request.query or "").strip()
        if not query:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT, "A search query is required"
            )

        budget = await self._budget_state(organization_id)

        result = await self._retrieval.retrieve(
            query,
            ctx,
            settings,
            budget=budget,
            limit=_clamped_limit(request.limit, settings.final_context_k),
            skip_rerank=request.skip_rerank,
        )

        return rag_pb2.SearchResponse(
            chunks=[
                rag_pb2.RetrievedChunk(
                    chunk_id=chunk.chunk_id,
                    document_id=chunk.document_id,
                    document_title=chunk.document_title,
                    page_number=chunk.page_number,
                    chunk_index=chunk.chunk_index,
                    content_text=chunk.content_text,
                    score=chunk.score,
                    vector_point_id=chunk.vector_point_id,
                )
                for chunk in result.chunks
            ],
            degraded=(
                rag_pb2.SEARCH_DEGRADATION_LEXICAL_ONLY
                if result.lexical_only
                else rag_pb2.SEARCH_DEGRADATION_UNSPECIFIED
            ),
        )

    # -----------------------------------------------------------------
    # Generation
    # -----------------------------------------------------------------
    async def Chat(
        self,
        request: rag_pb2.ChatRequest,
        context: grpc.aio.ServicerContext,
    ):
        """Tier 1 chat, STREAMED — the hot path.

        The order below is load-bearing and each step was wrong in an earlier
        draft:

          1. **Layer 1 greeting detection runs FIRST**, ahead of the budget
             check, so a greeting costs nothing at all and is answered even at
             the cap.
          2. **The budget check comes next**, and at the cap this
             auto-escalates rather than erroring — a user asking a real
             question gets a human, not a 402.
          3. Layer 2, then reformulation, then retrieval, then generation.
        """
        ctx = unpack_caller_context(context.invocation_metadata())

        try:
            organization_id = require_tenant(ctx)
        except MissingTenantError as error:
            await context.abort(grpc.StatusCode.FAILED_PRECONDITION, str(error))
            return

        settings = await self._deps.settings.settings_for(organization_id)
        budget = await self._budget_state(organization_id)

        history = [
            Turn(role=turn.role, content=turn.content) for turn in request.history
        ]
        ticket_id = request.ticket_id if request.HasField("ticket_id") else None

        # The files that came with THIS message. History turns
        # contribute their text and nothing else.
        attachments = _attachments_of(request)

        preprocessed = await self._preprocess.run(
            request.message,
            history,
            settings,
            budget=budget,
            user_id=ctx.sub,
            attachments=attachments,
            # **What the message CARRIED, not what survived.** `attachments` is
            # already filtered — ineligible types, oversize files and failed
            # extractions are all gone by here — so a message that arrived with
            # a file the caller could not turn into a part looks identical to
            # one with no file at all. The greeting rule needs to tell them
            # apart; nothing else here does.
            attachment_count=request.attachment_count,
        )

        if preprocessed.reply is not None:
            # A canned reply — a greeting or a refusal. No LLM call, no ledger
            # row, no citations, and it works at the cap.
            #
            # **The status distinguishes the two, and it has to**.
            # The gateway persists any completion that is not AT_CAP as an AI
            # message and passes the label onward, so a refusal reported as
            # GREETING is wrong in the ticket thread and wrong in the frame the
            # client renders.
            yield rag_pb2.ChatChunk(token=preprocessed.reply)
            yield rag_pb2.ChatChunk(
                completion=rag_pb2.ChatCompletion(
                    status=(
                        rag_pb2.ANSWER_STATUS_REFUSED
                        if preprocessed.intent is Intent.REFUSED
                        else rag_pb2.ANSWER_STATUS_GREETING
                    ),
                    content=preprocessed.reply,
                )
            )
            return

        if not budget.allows_embedding:
            # AT THE CAP. The caller escalates to the default department; this
            # says so rather than erroring, because a 402 mid-conversation is
            # a dead end for a user who cannot buy anything.
            yield rag_pb2.ChatChunk(
                completion=rag_pb2.ChatCompletion(status=rag_pb2.ANSWER_STATUS_AT_CAP)
            )
            return

        result = await self._retrieval.retrieve(
            preprocessed.query, ctx, settings, budget=budget
        )

        async for item in self._corag.stream_answer(
            preprocessed.query,
            result.chunks,
            settings,
            budget=budget,
            purpose=AiGenerationPurpose.CHAT_ANSWER,
            retrieved_chunk_ids=result.retrieved_chunk_ids,
            user_id=ctx.sub,
            ticket_id=ticket_id,
            # The answering call sees the file too. Reformulation
            # turned it into search terms; this is where it becomes something
            # the answer can describe.
            attachments=attachments,
        ):
            if isinstance(item, GeneratedAnswer):
                yield rag_pb2.ChatChunk(completion=_completion(item))
            else:
                yield rag_pb2.ChatChunk(token=item.text)

    async def Ask(
        self,
        request: rag_pb2.ChatRequest,
        context: grpc.aio.ServicerContext,
    ) -> rag_pb2.ChatResponse:
        """One-shot Q&A. **Not Tier 1 chat with the persistence removed.**

        One difference matters: there is no conversation to escalate into, so
        `DOC_MISSING` returns an explicit "nothing covers this" rather than
        offering a handoff it cannot perform. And at the cap it aborts
        PERMISSION_DENIED carrying the `[http:402]` marker rather than
        degrading — retrieval could degrade, but there is no free version of an
        ANSWER. Not FAILED_PRECONDITION: that is the missing-tenant arm twelve
        lines below, and one name for two failures is a wrong turn in the one
        place a reader would check.
        """
        ctx = unpack_caller_context(context.invocation_metadata())

        try:
            organization_id = require_tenant(ctx)
        except MissingTenantError as error:
            await context.abort(grpc.StatusCode.FAILED_PRECONDITION, str(error))

        settings = await self._deps.settings.settings_for(organization_id)
        budget = await self._budget_state(organization_id)

        if not budget.allows_embedding:
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED,
                AT_CAP_REFUSAL,
            )

        # **The guard, called here because `Ask` never touches the preprocess
        # pipeline**. Both layers at once: there is no greeting
        # check on this surface to split them around, and greetings do not
        # arrive at a programmatic one.
        #
        # **No attachments here, and none possible**.
        # `/knowledge/ask` has no ticket and no message, so there is nothing to
        # attach. Adding the parameter would advertise a capability the RPC
        # cannot carry.
        verdict = await self._injection.scan(
            request.message, settings=settings, budget=budget, user_id=ctx.sub
        )
        if verdict.refused:
            return rag_pb2.ChatResponse(
                content=refusal_reply(verdict.language),
                status=rag_pb2.ANSWER_STATUS_REFUSED,
            )

        result = await self._retrieval.retrieve(
            request.message, ctx, settings, budget=budget
        )
        answer = await self._corag.generate(
            request.message,
            result.chunks,
            settings,
            budget=budget,
            purpose=AiGenerationPurpose.CHAT_ANSWER,
            retrieved_chunk_ids=result.retrieved_chunk_ids,
            user_id=ctx.sub,
            # NULL, deliberately: this surface creates no ticket, so attributing
            # its spend to one would be inventing an association.
            ticket_id=None,
            # **No handoff offer**. There is no conversation to
            # escalate into, so offering one promises something this surface
            # cannot perform, and a user who accepts gets nothing.
            can_escalate=False,
        )

        return rag_pb2.ChatResponse(
            content=answer.content,
            status=_status_of(answer),
            citations=_citations(answer),
            generation_id=answer.generation_id,
        )

    async def Draft(
        self,
        request: rag_pb2.DraftRequest,
        context: grpc.aio.ServicerContext,
    ) -> rag_pb2.DraftResponse:
        """The co-pilot's draft. **Never auto-sent** — this persists nothing.

        `ticket-service` owns `ticket_messages` and this service could not
        write one if it tried, which is a structural version of the product's
        human-approves promise rather than a rule someone has to remember.
        """
        ctx = unpack_caller_context(context.invocation_metadata())
        _, settings, budget = await self._prepare(ctx, context)

        if not budget.allows_embedding:
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED,
                AT_CAP_REFUSAL,
            )

        question = _last_user_message(request.history)

        # **The guard, on the surface that most needs it**. This
        # "question" is the last message on a ticket, and with inbound email
        # that can be an email from outside the organisation: an agent clicks
        # *suggest a reply* and a stranger's text becomes the question in a
        # prompt whose output the agent is about to send back to them.
        #
        # **The attachments go to the guard on this surface above all** —
        # The file was chosen by whoever wrote that last message, and
        # after 31/32 that can be a stranger who never authenticated. An
        # instruction painted into their screenshot reaches a prompt whose
        # output an agent is about to send back to them.
        draft_attachments = _attachments_of(request)

        refusal = await self._injection.scan(
            question,
            settings=settings,
            budget=budget,
            user_id=ctx.sub,
            attachments=draft_attachments,
        )
        if refusal.refused:
            await context.abort(grpc.StatusCode.FAILED_PRECONDITION, DRAFT_REFUSAL)

        result = await self._retrieval.retrieve(question, ctx, settings, budget=budget)

        answer = await self._corag.generate_reviewed(
            question,
            result.chunks,
            settings,
            budget=budget,
            purpose=AiGenerationPurpose.DRAFT,
            retrieved_chunk_ids=result.retrieved_chunk_ids,
            # Clamped, and through the SAME clamp every other setting uses. An
            # unbounded retry count from a caller is an unbounded bill, and the
            # co-pilot is the one surface where a caller can ask for more
            # passes at all.
            max_retries=with_co_rag_retries(
                settings, request.max_retries or settings.co_rag_max_retries
            ).co_rag_max_retries,
            user_id=ctx.sub,
            ticket_id=request.ticket_id,
            # The drafting pass only — the review passes judge the answer
            # against the SOURCES, and re-sending an image on every retry would
            # multiply the cost of the one surface that retries.
            attachments=draft_attachments,
        )

        return rag_pb2.DraftResponse(
            draft=answer.content,
            citations=_citations(answer),
            # Returned so the client can hand it back as `generatedFromId` when
            # the agent posts — which is what closes the acceptance loop and
            # makes acceptance rate computable at all.
            generation_id=answer.generation_id,
            status=_status_of(answer),
        )

    async def Summarize(
        self,
        request: rag_pb2.SummaryRequest,
        context: grpc.aio.ServicerContext,
    ) -> rag_pb2.SummaryResponse:
        """A ticket summary — the ONE surface with a grace at the cap.

        RDM §1.14, and it is deliberately not uniform. At the cap deflection
        stops, so ticket volume spikes 3-5x; without this exemption every one
        of those tickets reaches an agent with no context, and the two failures
        compound. It is the cheapest call the system makes and it is worth most
        exactly when the queue floods.
        **Bounded at 10%, because an unbounded exemption is not a cap** — and
        only for the ESCALATION-triggered call. A manual summary is
        discretionary and refuses like everything else.
        """
        ctx = unpack_caller_context(context.invocation_metadata())
        organization_id, settings, budget = await self._prepare(ctx, context)

        if not budget.allows_embedding and not await self._within_grace(
            organization_id, request.triggered_by_escalation
        ):
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED,
                AT_CAP_REFUSAL,
            )

        summary = await self._copilot.summarize(
            request.ticket_id,
            _transcript(request.history),
            settings,
            budget=budget,
            triggered_by_escalation=request.triggered_by_escalation,
            user_id=ctx.sub,
        )

        return rag_pb2.SummaryResponse(
            summary_text=summary.summary_text,
            suggested_action=summary.suggested_action,
            confidence_score=summary.confidence_score,
            model_name=summary.model_name,
            generation_id=summary.generation_id,
        )

    async def Classify(
        self,
        request: rag_pb2.ClassifyRequest,
        context: grpc.aio.ServicerContext,
    ) -> rag_pb2.ClassifyResponse:
        """Routes a ticket, choosing only from departments the caller supplied."""
        ctx = unpack_caller_context(context.invocation_metadata())
        _, settings, budget = await self._prepare(ctx, context)

        if not budget.allows_embedding:
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED,
                AT_CAP_REFUSAL,
            )

        result = await self._copilot.classify(
            request.ticket_id,
            request.title,
            request.body,
            [(option.id, option.name) for option in request.departments],
            settings,
            budget=budget,
            user_id=ctx.sub,
            # The ticket's EARLIEST message's files — the third selection rule.
            # Empty for a ticket opened by email, which has no message until
            # somebody replies.
            attachments=_attachments_of(request),
        )

        return rag_pb2.ClassifyResponse(
            suggested_department_id=result.suggested_department_id,
            suggested_priority=result.suggested_priority,
            confidence_score=result.confidence_score,
            generation_id=result.generation_id,
        )

    async def Suggest(
        self,
        request: rag_pb2.SuggestionsRequest,
        context: grpc.aio.ServicerContext,
    ) -> rag_pb2.SuggestionsResponse:
        ctx = unpack_caller_context(context.invocation_metadata())
        _, settings, budget = await self._prepare(ctx, context)

        if not budget.allows_embedding:
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED,
                AT_CAP_REFUSAL,
            )

        suggestions, generation_id, articles = await self._copilot.suggest(
            request.ticket_id,
            _transcript(request.history),
            settings,
            budget=budget,
            user_id=ctx.sub,
            # The retrieval query. What the ticket IS, not where the
            # conversation got to, so the sidebar holds still while the thread
            # moves.
            title=request.title,
            body=request.body,
            # Retrieval is tenant- and department-scoped through this, and it is
            # the only thing that scopes it.
            ctx=ctx,
        )

        return rag_pb2.SuggestionsResponse(
            suggestions=[
                rag_pb2.Suggestion(
                    title=suggestion.title,
                    body=suggestion.body,
                    confidence_score=suggestion.confidence_score,
                )
                for suggestion in suggestions
            ],
            generation_id=generation_id,
            articles=[
                rag_pb2.SuggestedArticle(
                    document_id=article.document_id,
                    document_title=article.document_title,
                    page_number=article.page_number,
                    score=article.score,
                )
                for article in articles
            ],
        )

    async def _within_grace(
        self, organization_id: str, triggered_by_escalation: bool
    ) -> bool:
        """Whether an escalation summary may still run past the cap.

        The grace is applied HERE rather than by the caller, so a surface
        cannot grant itself one by passing a flag — `triggered_by_escalation`
        decides ELIGIBILITY, and the 10% ceiling decides whether the eligible
        call actually proceeds.
        """
        if not triggered_by_escalation:
            return False

        cycle_start, limit_micros = await self._entitlement(organization_id)
        spent = await QuotaCounter(self._deps.redis).spent(
            organization_id, cycle_start
        )

        # Fails CLOSED on an unreadable counter, like every other gate. The
        # grace is an exemption from the cap, not from knowing where the cap is.
        if spent is None:
            return False

        return spent < limit_micros + int(limit_micros * ESCALATION_GRACE_RATIO)

    async def _prepare(self, ctx, context):
        try:
            organization_id = require_tenant(ctx)
        except MissingTenantError as error:
            await context.abort(grpc.StatusCode.FAILED_PRECONDITION, str(error))
            # Unreachable. `ServicerContext.abort` raises rather than returning,
            # but it is not annotated `NoReturn`, so without this a checker
            # reads `organization_id` below as possibly-unbound — and it is
            # right to, on the evidence available to it.
            raise

        return (
            organization_id,
            await self._deps.settings.settings_for(organization_id),
            await self._budget_state(organization_id),
        )

    async def _budget_state(self, organization_id: str) -> BudgetState:
        """Reads the counter once, for the whole request.

        **Fails CLOSED**: an unreadable counter means the embedding is skipped
        and search degrades, never that it proceeds unmetered. That is the one
        place a cache miss must not mean "allow", and here
        the cost of failing closed is a keyword search rather than an error.
        """
        cycle_start, limit_micros = await self._entitlement(organization_id)
        spent = await QuotaCounter(self._deps.redis).spent(organization_id, cycle_start)

        return BudgetState(
            organization_id=organization_id,
            cycle_start=cycle_start,
            allows_embedding=spent is not None and spent < limit_micros,
        )

    async def _entitlement(self, organization_id: str) -> tuple[datetime, int]:
        """The tenant's cycle and allowance.

        Reads auth-service in production. Today it returns a permissive default,
        and the shape is what matters: the CALLER never sees this — it is behind
        `_budget_state` — so wiring the real entitlement read is a change to one
        method with no signature anywhere else moving.
        """
        _ = organization_id

        return (
            datetime.now(timezone.utc).replace(
                day=1, hour=0, minute=0, second=0, microsecond=0
            ),
            2**62,
        )


def _clamped_limit(requested: int, default: int) -> int:
    """The caller's limit, bounded. Zero means "use the default".

    Clamped rather than rejected: refusing a request over a number that has a
    perfectly serviceable safe answer fails a user for a client-side mistake,
    and the bound IS that answer.
    """
    if requested <= 0:
        return default

    return min(requested, MAX_SEARCH_LIMIT)


def build_injection_guard(config: Config, metered) -> InjectionGuard:
    """Layer A from patterns, Layer B from the cheap tier

    **No model to load and nothing to fail at boot**, which is the difference
    from the design this replaced: the classifier is a call to a provider whose
    credential the embedding client already validates at startup, so there is no
    boot-closed check left to make. What can still fail is the call itself, and
    The answer is run-open with a distinct log event.

    Both switches are explicit rather than implied by whether a collaborator was
    passed, because "no patterns" and "patterns that match nothing" are
    different states and only one of them is a decision.
    """
    if not config.injection_regex_enabled:
        logger.warning(
            "Injection pattern matching is DISABLED by configuration — "
            "Layer A is not running"
        )

    if not config.injection_llm_enabled:
        logger.warning(
            "Injection classification is DISABLED by configuration — "
            "Layer B is not running"
        )

    return InjectionGuard(
        classifier=(
            LlmInjectionClassifier(metered) if config.injection_llm_enabled else None
        ),
        patterns_enabled=config.injection_regex_enabled,
        classifier_enabled=config.injection_llm_enabled,
    )


async def build_dependencies(config: Config) -> Dependencies:
    """Constructs the real collaborators. Tests build their own.

    Which is why the key check lives HERE and not in `load_config`: the suite
    never reaches this function, so a developer running the tests needs no
    Gemini key — the embedding client is substituted outright — while anyone
    starting a real server needs one before the first question, not after it.
    """
    if not config.gemini_api_key:
        # Checked before constructing anything. Without it the first failure is
        # `ValueError: Missing key inputs argument!` raised inside
        # `google.genai`, eight frames deep, naming neither this service nor the
        # variable that is actually missing.
        raise RuntimeError(
            "GEMINI_API_KEY is empty. The server needs it for embeddings and "
            "generation; set it in apps/rag-service/.env. (The test suite does "
            "not — it substitutes the embedding client.)"
        )

    qdrant = AsyncQdrantClient(url=config.qdrant_url)
    await ensure_collection(qdrant)

    pool = await asyncpg.create_pool(config.ingestion_database_url, min_size=2, max_size=10)

    client = redis.from_url(config.redis_url, db=config.redis_db, decode_responses=True)

    channel = grpc.aio.insecure_channel(config.ingestion_service_url)

    # One provider client, shared. Layer B's classification is the same cheap
    # tier the preprocessing steps already use, so giving it its own client
    # would mean a second connection pool for the same model.
    generator = GeminiGenerator(config.gemini_api_key)
    ledger = LedgerClient(channel)

    return Dependencies(
        qdrant=qdrant,
        pool=pool,
        redis=client,
        embeddings=GeminiEmbeddingClient(config.gemini_api_key),
        reranker=FlashRankReranker(),
        injection=build_injection_guard(
            config, MeteredGenerator(generator, ledger, QuotaCounter(client))
        ),
        generator=generator,
        ledger=ledger,
        settings=AiSettingsResolver(),
    )


#: The sub-service name a READINESS probe asks for — matches
#: `READINESS_SERVICE` in `libs/grpc-proto/src/constants.ts`. `""` is the
#: standard's "the server as a whole" and is what a liveness probe sends, so one
#: port answers two genuinely different questions.
READINESS_SERVICE = "readiness"

#: How long the whole readiness sweep may take. A dependency that has stopped
#: answering usually accepts the connection and never replies, so an unbounded
#: check would hold the refresh loop open indefinitely and leave the cached
#: status stale at whatever it last was — reporting SERVING throughout an outage.
READINESS_TIMEOUT_SECONDS = 2.0

#: How often the cached status is recomputed. Half the TTL a kubelet would
#: tolerate, so a genuine failure is visible within one probe interval.
READINESS_REFRESH_SECONDS = 5.0


class OpsServicer(ops_pb2_grpc.OpsServiceServicer):
    """`/version` for the Python peer

    **Every service serves it, not just the gateway.** A rolling deploy where one
    service lagged is exactly the state this diagnoses, and a gateway-only
    version endpoint reports the new SHA while the peer still running the old
    code is the one causing the incident.

    Read from the environment, never from git: a container has no `.git`, so a
    runtime lookup returns nothing and the natural fallback is `"unknown"` — the
    answer you get at exactly the moment you need the real one. The Dockerfile's
    `test -n "$GIT_SHA"` guard is what makes the environment reliable.
    """

    async def GetVersion(
        self,
        request: ops_pb2.VersionRequest,
        context: grpc.aio.ServicerContext,
    ) -> ops_pb2.VersionResponse:
        return ops_pb2.VersionResponse(
            version=os.environ.get("APP_VERSION", ""),
            sha=os.environ.get("BUILD_SHA", ""),
            built_at=os.environ.get("BUILD_TIME", ""),
        )


async def _readiness_status(deps: Dependencies) -> health_pb2.HealthCheckResponse.ServingStatus:
    """What this service OWNS: Qdrant, Postgres, Redis

    **No peer is checked**, and that is the rule rather than an omission. This
    service is called by the gateway and calls ingestion-service's ledger; making
    either part of readiness would let one service's database failure take this
    one out of rotation too, which is the readiness cascade one level down.

    Every probe is bounded and reuses a connection the process already holds. A
    probe every five seconds that dials is a connection leak with a schedule.
    """

    async def qdrant_ok() -> bool:
        await deps.qdrant.get_collections()
        return True

    async def postgres_ok() -> bool:
        async with deps.pool.acquire() as connection:
            await connection.execute("SELECT 1")
        return True

    async def redis_ok() -> bool:
        return bool(await deps.redis.ping())

    checks = (qdrant_ok(), postgres_ok(), redis_ok())
    try:
        results = await asyncio.wait_for(
            asyncio.gather(*checks, return_exceptions=True),
            timeout=READINESS_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return health_pb2.HealthCheckResponse.NOT_SERVING

    if all(result is True for result in results):
        return health_pb2.HealthCheckResponse.SERVING

    for name, result in zip(("qdrant", "postgres", "redis"), results, strict=True):
        if result is not True:
            logger.warning("Readiness: %s is not available (%s)", name, result)

    return health_pb2.HealthCheckResponse.NOT_SERVING


async def _refresh_readiness(deps: Dependencies, servicer: health_aio.HealthServicer) -> None:
    """Keeps the health servicer's cached status current.

    **The status is PUSHED on a timer rather than computed inside `Check`.**
    `grpc_health.v1.health.HealthServicer` answers from a stored value, which is
    the shape the standard implementation has — and it is the right one here for
    a second reason: a probe that ran three network checks inline would let a
    slow dependency turn every readiness call into a timeout, on a path the
    kubelet calls every few seconds per pod.
    """
    while True:
        status_now = await _readiness_status(deps)
        await servicer.set(READINESS_SERVICE, status_now)
        await asyncio.sleep(READINESS_REFRESH_SECONDS)


async def serve() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))

    config = load_config()

    # At BOOT, before serving. A model discovered unpriced at first use has
    # already been metered as free at least once.
    assert_pricing_table_covers(ALL_CONFIGURED_MODELS)

    deps = await build_dependencies(config)

    # **Options, not the default**. Without these the server sits
    # at gRPC's 4 MB while every TypeScript client and server is at 10 MB, and
    # the mismatch only shows up as RESOURCE_EXHAUSTED on a request the caller
    # had no reason to think was too large.
    server = grpc.aio.server(options=GRPC_SERVER_OPTIONS)
    rag_pb2_grpc.add_RagServiceServicer_to_server(RagServicer(deps), server)

    # The ops surface, on the SAME port No HTTP listener and no
    # second port: the kubelet probes `grpc.health.v1.Health` natively.
    #
    #   livenessProbe:  { grpc: { port: 50054, service: "" } }
    #   readinessProbe: { grpc: { port: 50054, service: "readiness" } }
    # The ASYNC servicer, not `grpc_health.v1.health.HealthServicer`. That one
    # is the threaded implementation: its `set()` is synchronous and its `Check`
    # blocks a thread this server does not have, because everything here runs on
    # `grpc.aio`. The mistake is silent in Python and produces a health service
    # that misbehaves under the async server — which reads as a probe timeout,
    # i.e. as the process being unhealthy.
    #
    # Imported from `_async` rather than through `health.aio`: the alias exists
    # (`health.py` does `from. import _async as aio`) but it is an
    # `unused-import` re-export that type checkers do not see through.
    health_servicer = health_aio.HealthServicer()
    # `""` is the standard's "the server as a whole" — liveness. Set SERVING
    # once and never reconsidered: if this process can answer at all it is
    # alive, and anything else it might check is a reason to route traffic
    # away, not a reason for the kubelet to kill it.
    await health_servicer.set("", health_pb2.HealthCheckResponse.SERVING)
    await health_servicer.set(
        READINESS_SERVICE, health_pb2.HealthCheckResponse.NOT_SERVING
    )
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    ops_pb2_grpc.add_OpsServiceServicer_to_server(OpsServicer(), server)

    server.add_insecure_port(f"{config.grpc_host}:{config.grpc_port}")

    await server.start()
    readiness_task = asyncio.create_task(_refresh_readiness(deps, health_servicer))
    logger.info("🧠 [RAG Service] gRPC server listening on %s:%s", config.grpc_host, config.grpc_port)

    try:
        await server.wait_for_termination()
    finally:
        readiness_task.cancel()
        # Readiness goes red BEFORE the port closes, so the load balancer stops
        # sending work this process will not finish. Without it every rolling
        # deploy is a small burst of failed requests.
        await health_servicer.set(
            READINESS_SERVICE, health_pb2.HealthCheckResponse.NOT_SERVING
        )
        # Drains in-flight ledger writes before the process goes. Without it a
        # graceful shutdown drops exactly the rows recording the last requests
        # before it — the ones most likely to be under investigation.
        await deps.ledger.drain()
        await server.stop(grace=5)


if __name__ == "__main__":
    asyncio.run(serve())


# ---------------------------------------------------------------------------
# Proto mapping
# ---------------------------------------------------------------------------


def _completion(answer: GeneratedAnswer) -> rag_pb2.ChatCompletion:
    return rag_pb2.ChatCompletion(
        status=_status_of(answer),
        citations=_citations(answer),
        generation_id=answer.generation_id,
        content=answer.content,
    )


def _citations(answer: GeneratedAnswer) -> list[rag_pb2.Citation]:
    return [
        rag_pb2.Citation(
            chunk_id=citation.chunk_id,
            document_id=citation.document_id,
            document_title=citation.document_title,
            page_number=citation.page_number,
            vector_point_id=citation.vector_point_id,
        )
        for citation in answer.citations
    ]


def _status_of(answer: GeneratedAnswer) -> rag_pb2.AnswerStatus:
    """The proto enum, NOT a bare `int`.

    `AnswerStatus` subclasses `int`, so the loose annotation type-checked
    against nothing while every proto constructor here declares the narrow
    type — meaning any int at all satisfied the old signature, including one
    from a different proto enum entirely.
    """
    return (
        rag_pb2.ANSWER_STATUS_DOC_MISSING
        if answer.status == "DOC_MISSING"
        else rag_pb2.ANSWER_STATUS_DOC_ANSWER
    )


def _attachments_of(request) -> list[Attachment]:
    """The request's attachment parts as domain objects

    **Filtered and capped before they got here.** Ticket-service decided
    eligibility from the `message_attachments` row and refused anything past
    `MAX_AI_ATTACHMENT_BYTES`, so this is a shape change and not a policy one —
    which is why there is no validation to do at this boundary.

    `file_name` is carried for the log and the boundary label. **Never for the
    contents**: it is attacker-chosen text, exactly like `error_log` and
    `DocumentFlag.detail`.
    """
    return [
        Attachment(
            mime_type=part.mime_type,
            data=part.data,
            file_name=part.file_name,
        )
        for part in request.attachments
    ]


def _last_user_message(history) -> str:
    """The question a draft is answering.

    Reads BACKWARDS for the last user turn rather than taking the last message
    outright: the last message on a ticket is frequently an agent's own note,
    and drafting a reply to your own note produces confident nonsense.
    """
    for turn in reversed(list(history)):
        if turn.role == "user":
            return turn.content

    return history[-1].content if history else ""


def _transcript(history) -> str:
    """The conversation, oldest first, as plain text.

    Roles are kept. A transcript that flattened who said what would ask a model
    to summarise a conversation without knowing which half was the customer,
    and the summaries come out attributing the agent's questions to the user.
    """
    return "\n".join(f"{turn.role}: {turn.content}" for turn in history)
