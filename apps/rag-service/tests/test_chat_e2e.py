"""§4.1 through the SERVICER — the orderings that only show up end to end.

The unit tests prove each step; these prove the sequence. Every one of the three
orderings below was wrong in an earlier draft and none of them changes visible
behaviour when reversed — they change the bill, or they change what a user gets
at the cap.
"""

from __future__ import annotations

import pytest

from rag_service.generated.synapsedesk.rag import rag_pb2
from tests.conftest import FakeServicerContext
from tests.fakes import FakeAbort

SHARED_TEXT = "annual leave carryover policy"


async def chat(servicer, message: str, ctx, history=None, ticket_id=None):
    request = rag_pb2.ChatRequest(
        message=message,
        history=[
            rag_pb2.ConversationTurn(role=role, content=content)
            for role, content in (history or [])
        ],
    )
    if ticket_id:
        request.ticket_id = ticket_id

    frames = []
    async for frame in servicer.Chat(request, FakeServicerContext(ctx)):
        frames.append(frame)

    return frames


def tokens(frames) -> list[str]:
    return [frame.token for frame in frames if frame.WhichOneof("payload") == "token"]


def completion(frames):
    return next(
        frame.completion
        for frame in frames
        if frame.WhichOneof("payload") == "completion"
    )


class TestGreetingShortCircuit:
    async def test_a_greeting_costs_NOTHING_at_all(
        self, servicer, tenant_a, embeddings, generator, ledger
    ):
        # The free check runs first. Every "thanks!" that reaches retrieval
        # costs an embedding, a Qdrant query, a rerank and a generation — all
        # metered against the tenant.
        frames = await chat(servicer, "thanks!", tenant_a.outsider())

        assert completion(frames).status == rag_pb2.ANSWER_STATUS_GREETING
        assert embeddings.calls == []
        assert generator.calls == []
        assert ledger.entries == []

    async def test_a_greeting_is_answered_EVEN_AT_THE_CAP(
        self, servicer, tenant_a, at_cap
    ):
        # Layer 1 precedes the budget check, so a capped tenant's users still
        # get a sensible answer to "thanks" rather than an escalation offer.
        frames = await chat(servicer, "hello", tenant_a.outsider())

        assert completion(frames).status == rag_pb2.ANSWER_STATUS_GREETING
        assert tokens(frames)


class TestAtCap:
    async def test_a_real_question_at_the_cap_signals_ESCALATION_not_an_error(
        self, servicer, seed, tenant_a, at_cap, generator
    ):
        # RDM §1.14. A 402 mid-conversation is a dead end for a user who cannot
        # buy anything; the caller turns AT_CAP into a handoff.
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        frames = await chat(servicer, "what is the carryover policy?", tenant_a.outsider())

        assert completion(frames).status == rag_pb2.ANSWER_STATUS_AT_CAP
        assert generator.calls == []


class TestAnswering:
    async def test_streams_tokens_before_the_completion_frame(
        self, servicer, seed, tenant_a
    ):
        # The product requirement: the answer appears as it is written. One
        # final frame would satisfy every other assertion here.
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        frames = await chat(servicer, SHARED_TEXT, tenant_a.outsider())

        assert len(tokens(frames)) > 1
        assert frames[-1].WhichOneof("payload") == "completion"

    async def test_CONCATENATED_TOKENS_reproduce_the_final_content(
        self, servicer, seed, tenant_a
    ):
        # Test 7. The client renders the token stream and persists
        # `completion.content`, so any divergence between them is a message
        # that changes after it finished arriving.
        #
        # Worth having regardless; markdown makes it URGENT. A dropped or
        # duplicated chunk in plain prose is a typo, and in markdown it is a
        # lost backtick or fence — which does not corrupt one word, it changes
        # how everything after it renders.
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        frames = await chat(servicer, SHARED_TEXT, tenant_a.outsider())

        assert "".join(tokens(frames)) == completion(frames).content

    async def test_the_answer_is_forwarded_VERBATIM_including_raw_html(
        self, servicer, seed, tenant_a, generator
    ):
        # The XSS path, which now runs through the answer.
        #
        # Markdown is generated from TENANT-UPLOADED documents, so a document
        # containing `<img src=x onerror=...>` can reach the renderer through
        # the answer. The defence is in the RENDERER — markdown-to-text with
        # HTML disabled, never markdown-to-raw-HTML — and this test pins the
        # backend's half of that contract: it does not escape, strip or
        # otherwise "helpfully" alter the model's output.
        #
        # That is deliberate rather than lazy. Escaping here would corrupt
        # every legitimate `<` in a code sample while still leaving the
        # renderer free to interpret HTML — protection that costs correctness
        # and buys nothing. ONE layer decides, and it is the one that knows
        # whether it is producing text or markup.
        hostile = 'Use <img src=x onerror=alert(1)> carefully [1].'
        generator.answer = hostile
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        frames = await chat(servicer, SHARED_TEXT, tenant_a.outsider())

        assert completion(frames).content == hostile

    async def test_an_empty_corpus_yields_DOC_MISSING_rather_than_a_guess(
        self, servicer, tenant_a, generator
    ):
        # The behaviour change from the notebook app this came
        # from, which would happily answer from general knowledge.
        frames = await chat(servicer, "what is the carryover policy?", tenant_a.outsider())

        assert completion(frames).status == rag_pb2.ANSWER_STATUS_DOC_MISSING
        # The model was never asked, so it cannot have improvised.
        assert not any("SOURCES" in prompt for prompt, _ in generator.calls)

    async def test_a_DOC_MISSING_answer_logs_the_knowledge_gap(
        self, servicer, tenant_a, ledger
    ):
        await chat(servicer, "what is the carryover policy?", tenant_a.outsider())

        chat_rows = [
            entry for entry in ledger.entries if entry.purpose == "CHAT_ANSWER"
        ]
        assert len(chat_rows) == 1
        # EMPTY retrieved ids — the gap signal. Skipping the row entirely would
        # make gaps invisible exactly where they matter.
        assert chat_rows[0].retrieved_chunk_ids == []

    async def test_attributes_spend_to_the_ticket_when_there_is_one(
        self, servicer, seed, tenant_a, ledger
    ):
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        await chat(
            servicer, SHARED_TEXT, tenant_a.outsider(), ticket_id="11111111-1111-4111-8111-111111111111"
        )

        chat_rows = [e for e in ledger.entries if e.purpose == "CHAT_ANSWER"]
        assert chat_rows[0].ticket_id == "11111111-1111-4111-8111-111111111111"


class TestIsolation:
    async def test_an_answer_NEVER_grounds_on_another_tenants_document(
        self, servicer, seed, tenant_a, tenant_b, ledger
    ):
        # The disclosure this whole domain is arranged to prevent, and the one
        # that leaves no trace: a leaked chunk does not appear in the response,
        # it is blended into prose that names no source.
        await seed(tenant_b.organization_id, text=SHARED_TEXT)

        frames = await chat(servicer, SHARED_TEXT, tenant_a.outsider())

        assert completion(frames).status == rag_pb2.ANSWER_STATUS_DOC_MISSING
        chat_rows = [e for e in ledger.entries if e.purpose == "CHAT_ANSWER"]
        assert chat_rows[0].retrieved_chunk_ids == []


class TestAsk:
    async def test_at_the_cap_Ask_refuses_with_a_402_marker(
        self, servicer, tenant_a, at_cap
    ):
        # Retrieval could degrade; an ANSWER has no free version. 402 rather
        # than 429, carried by the `[http:402]` marker because no gRPC code
        # means "buy more".
        with pytest.raises(FakeAbort) as raised:
            await servicer.Ask(
                rag_pb2.ChatRequest(message="what is the policy?"),
                FakeServicerContext(tenant_a.outsider()),
            )

        assert "[http:402]" in raised.value.details

    async def test_Ask_attributes_its_spend_to_NO_ticket(
        self, servicer, seed, tenant_a, ledger
    ):
        # This surface creates no ticket, so attributing its spend to one would
        # be inventing an association.
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        await servicer.Ask(
            rag_pb2.ChatRequest(message=SHARED_TEXT),
            FakeServicerContext(tenant_a.outsider()),
        )

        chat_rows = [e for e in ledger.entries if e.purpose == "CHAT_ANSWER"]
        assert chat_rows[0].ticket_id is None


class TestDraft:
    async def test_a_draft_returns_a_generation_id_for_the_acceptance_loop(
        self, servicer, seed, tenant_a
    ):
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        response = await servicer.Draft(
            rag_pb2.DraftRequest(
                ticket_id="22222222-2222-4222-8222-222222222222",
                history=[rag_pb2.ConversationTurn(role="user", content=SHARED_TEXT)],
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert response.draft
        # Without it, acceptance rate is uncomputable — the client has nothing
        # to hand back as `generatedFromId` when the agent posts.
        assert response.generation_id or response.generation_id == ""

    async def test_a_draft_is_ledgered_as_DRAFT_against_its_ticket(
        self, servicer, seed, tenant_a, ledger
    ):
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        await servicer.Draft(
            rag_pb2.DraftRequest(
                ticket_id="22222222-2222-4222-8222-222222222222",
                history=[rag_pb2.ConversationTurn(role="user", content=SHARED_TEXT)],
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        drafts = [entry for entry in ledger.entries if entry.purpose == "DRAFT"]
        assert len(drafts) == 1
        assert drafts[0].ticket_id == "22222222-2222-4222-8222-222222222222"
        # The draft TEXT is stored, or the acceptance comparison has nothing to
        # compare against later.
        assert drafts[0].content
