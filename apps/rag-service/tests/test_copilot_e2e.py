"""§2.4 and §4.2 — `/knowledge/ask` and the co-pilot's non-drafting surfaces.

The behaviour worth pinning here is not the generation — it is what each surface
does when it CANNOT answer, and what each one does at the cap. Those differ per
surface on purpose, and "simplify them to be uniform" is a plausible-sounding
change that breaks two things at once.
"""

from __future__ import annotations

import json

import pytest

from rag_service.enums import AiGenerationPurpose
from rag_service.generated.synapsedesk.rag import rag_pb2
from rag_service.generation.corag import (
    DOC_MISSING_NO_HANDOFF,
    DOC_MISSING_WITH_HANDOFF,
)
from tests.conftest import FakeServicerContext
from tests.fakes import FakeAbort

SHARED_TEXT = "annual leave carryover policy"
TICKET_ID = "77777777-7777-4777-8777-777777777777"


def turns(*pairs):
    return [
        rag_pb2.ConversationTurn(role=role, content=content) for role, content in pairs
    ]


class TestAskRefusesWithoutOverPromising:
    """§2.4 test 4 — the difference between Ask and chat, made mechanical."""

    async def test_DOC_MISSING_offers_NO_handoff_it_cannot_perform(
        self, servicer, tenant_a
    ):
        # `/knowledge/ask` has no conversation and no ticket, so there is
        # nothing to escalate INTO. Offering a handoff promises something the
        # surface cannot do, and a user who accepts gets nothing — which is
        # worse than a plain "nothing covers this".
        response = await servicer.Ask(
            rag_pb2.ChatRequest(message="what is the carryover policy?"),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert response.status == rag_pb2.ANSWER_STATUS_DOC_MISSING
        assert response.content == DOC_MISSING_NO_HANDOFF
        assert "hand this over" not in response.content

    async def test_CHAT_still_offers_the_handoff_it_CAN_perform(
        self, servicer, tenant_a
    ):
        frames = []
        async for frame in servicer.Chat(
            rag_pb2.ChatRequest(message="what is the carryover policy?"),
            FakeServicerContext(tenant_a.outsider()),
        ):
            frames.append(frame)

        completion = next(
            frame.completion
            for frame in frames
            if frame.WhichOneof("payload") == "completion"
        )
        assert completion.status == rag_pb2.ANSWER_STATUS_DOC_MISSING
        assert completion.content == DOC_MISSING_WITH_HANDOFF

    async def test_DOC_MISSING_never_answers_from_GENERAL_KNOWLEDGE(
        self, servicer, tenant_a, generator
    ):
        # An enterprise support bot inventing a policy is worse than one that
        # escalates. The model is never asked, so it cannot have improvised.
        await servicer.Ask(
            rag_pb2.ChatRequest(message="what is the carryover policy?"),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert generator.calls == []

    async def test_DOC_MISSING_still_logs_the_knowledge_gap(
        self, servicer, tenant_a, ledger
    ):
        await servicer.Ask(
            rag_pb2.ChatRequest(message="what is the carryover policy?"),
            FakeServicerContext(tenant_a.outsider()),
        )

        rows = [
            entry
            for entry in ledger.entries
            if entry.purpose == AiGenerationPurpose.CHAT_ANSWER
        ]
        assert len(rows) == 1
        assert rows[0].retrieved_chunk_ids == []


class TestCitationsResolve:
    """§4.1 test 2 — a citation that cannot be resolved is not a citation."""

    async def test_a_citation_carries_the_vector_point_id_it_resolves_through(
        self, servicer, seed, tenant_a, generator, pool
    ):
        chunk = await seed(tenant_a.organization_id, text=SHARED_TEXT)
        generator.answer = "The policy says [1]."

        response = await servicer.Ask(
            rag_pb2.ChatRequest(message=SHARED_TEXT),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert len(response.citations) == 1
        citation = response.citations[0]
        assert citation.chunk_id == chunk.chunk_id
        # The FUSION KEY, carried through to the client. Without it a citation
        # is resolvable only from Postgres, and the whole point of the bridge
        # is that a hit in either store leads back to the same passage.
        assert citation.vector_point_id == chunk.vector_point_id

        # And it RESOLVES — to a real row, with the text the answer was
        # grounded in. A citation that only looked plausible would pass every
        # assertion above this line.
        async with pool.acquire() as connection:
            row = await connection.fetchrow(
                "SELECT content_text FROM document_chunks WHERE id = $1::uuid",
                citation.chunk_id,
            )

        assert row is not None
        assert row["content_text"] == SHARED_TEXT


class TestSummarize:
    async def test_returns_a_summary_and_the_ONE_action_it_suggests(
        self, servicer, tenant_a, generator
    ):
        # Both, because a summary an agent still has to read in full has saved
        # them nothing — the value is "here is what happened, do this next".
        generator.answer = json.dumps(
            {
                "summary": "Customer cannot log in after a password reset.",
                "action": "Verify the reset email reached them.",
                "confidence": 0.8,
            }
        )

        response = await servicer.Summarize(
            rag_pb2.SummaryRequest(
                ticket_id=TICKET_ID,
                history=turns(("user", "I can't log in"), ("agent", "Since when?")),
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert response.summary_text.startswith("Customer cannot log in")
        assert response.suggested_action
        assert response.confidence_score == pytest.approx(0.8)

    async def test_appends_a_SUMMARY_ledger_row_carrying_the_text(
        self, servicer, tenant_a, generator, ledger
    ):
        generator.answer = json.dumps({"summary": "s", "action": "a", "confidence": 1})

        await servicer.Summarize(
            rag_pb2.SummaryRequest(ticket_id=TICKET_ID, history=turns(("user", "hi"))),
            FakeServicerContext(tenant_a.outsider()),
        )

        rows = [
            entry
            for entry in ledger.entries
            if entry.purpose == AiGenerationPurpose.SUMMARY
        ]
        assert len(rows) == 1
        assert rows[0].ticket_id == TICKET_ID
        assert rows[0].content

    async def test_an_ESCALATION_summary_uses_the_SAME_purpose_as_a_manual_one(
        self, servicer, tenant_a, generator, ledger
    ):
        # The trigger decides the GATE, not the purpose. `ai_generations`
        # records what a call was FOR, and both are summaries — a separate
        # purpose would split one line item across two buckets in every report.
        generator.answer = json.dumps({"summary": "s", "action": "a", "confidence": 1})

        await servicer.Summarize(
            rag_pb2.SummaryRequest(
                ticket_id=TICKET_ID,
                history=turns(("user", "hi")),
                triggered_by_escalation=True,
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert [entry.purpose for entry in ledger.entries] == [
            AiGenerationPurpose.SUMMARY
        ]

    async def test_a_MANUAL_summary_REFUSES_at_the_cap(
        self, servicer, tenant_a, at_cap
    ):
        # Discretionary, so it refuses like everything else.
        #
        # The request and context are built OUTSIDE the block, so the only thing
        # inside it is the call under test. A constructor throwing in here would
        # otherwise be indistinguishable from the refusal being asserted.
        request = rag_pb2.SummaryRequest(
            ticket_id=TICKET_ID, history=turns(("user", "hi"))
        )
        context = FakeServicerContext(tenant_a.outsider())

        with pytest.raises(FakeAbort) as raised:
            await servicer.Summarize(request, context)

        assert "[http:402]" in raised.value.details

    async def test_an_ESCALATION_summary_RUNS_inside_the_grace(
        self, servicer, tenant_a, generator, budget_limit, redis_client
    ):
        # RDM §1.14, and deliberately not uniform. At the cap deflection stops,
        # so ticket volume spikes 3-5x — and without this every one of those
        # tickets reaches an agent with no context. The cheapest call the
        # system makes, worth most exactly when the queue floods.
        generator.answer = json.dumps({"summary": "s", "action": "a", "confidence": 1})

        budget_limit["limit_micros"] = 1_000
        # Spent past the cap but inside the 10% grace.
        await redis_client.set(_quota_key(tenant_a), "1_050".replace("_", ""))

        response = await servicer.Summarize(
            rag_pb2.SummaryRequest(
                ticket_id=TICKET_ID,
                history=turns(("user", "hi")),
                triggered_by_escalation=True,
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert response.summary_text

    async def test_the_grace_STOPS_once_it_is_spent(
        self, servicer, tenant_a, budget_limit, redis_client
    ):
        # Bounded, because an unbounded exemption is not a cap.
        budget_limit["limit_micros"] = 1_000
        await redis_client.set(_quota_key(tenant_a), "5000")

        request = rag_pb2.SummaryRequest(
            ticket_id=TICKET_ID,
            history=turns(("user", "hi")),
            triggered_by_escalation=True,
        )
        context = FakeServicerContext(tenant_a.outsider())

        with pytest.raises(FakeAbort) as raised:
            await servicer.Summarize(request, context)

        assert "[http:402]" in raised.value.details


class TestTheEscalationAsymmetry:
    """§4.2 tests 7-8 and doc 15 §3.2 — deliberately NOT uniform.

    At the cap, deflection stops: every question that would have been answered
    by AI now becomes a ticket, so volume spikes 3-5x. The escalation summary is
    the cheapest call the system makes and it is worth most exactly when the
    queue floods — without it, every one of those tickets reaches an agent with
    no context, and the two failures compound.

    Bounded, because an unbounded exemption is not a cap.
    """

    async def test_a_MANUAL_summary_and_an_ESCALATION_summary_differ_at_the_cap(
        self, servicer, tenant_a, generator, budget_limit, redis_client
    ):
        # Both calls, same tenant, same cap — and only one of them refuses.
        # A test that checked each in isolation would pass against an
        # implementation that had accidentally made them uniform in either
        # direction.
        generator.answer = json.dumps({"summary": "s", "action": "a", "confidence": 1})

        budget_limit["limit_micros"] = 1_000
        await redis_client.set(_quota_key(tenant_a), "1050")

        escalation = await servicer.Summarize(
            rag_pb2.SummaryRequest(
                ticket_id=TICKET_ID,
                history=turns(("user", "hi")),
                triggered_by_escalation=True,
            ),
            FakeServicerContext(tenant_a.outsider()),
        )
        assert escalation.summary_text

        with pytest.raises(FakeAbort) as raised:
            await servicer.Summarize(
                rag_pb2.SummaryRequest(
                    ticket_id=TICKET_ID,
                    history=turns(("user", "hi")),
                    triggered_by_escalation=False,
                ),
                FakeServicerContext(tenant_a.outsider()),
            )
        assert "[http:402]" in raised.value.details

    async def test_the_grace_is_a_CEILING_not_an_exemption(
        self, servicer, tenant_a, budget_limit, redis_client
    ):
        # 10% past the cap, and no further. An escalation summary at 5x the
        # allowance is not "the cheapest call the system makes" — it is an
        # uncapped one.
        budget_limit["limit_micros"] = 1_000
        await redis_client.set(_quota_key(tenant_a), "1101")

        with pytest.raises(FakeAbort):
            await servicer.Summarize(
                rag_pb2.SummaryRequest(
                    ticket_id=TICKET_ID,
                    history=turns(("user", "hi")),
                    triggered_by_escalation=True,
                ),
                FakeServicerContext(tenant_a.outsider()),
            )

    async def test_an_unreadable_counter_REFUSES_the_grace(
        self, servicer, tenant_a, broken_redis
    ):
        # Fails closed, like every other gate. The grace is an exemption from
        # the CAP, not from knowing where the cap is — granting it on an
        # unreadable counter would make an outage the cheapest way to get free
        # generations.
        with pytest.raises(FakeAbort):
            await servicer.Summarize(
                rag_pb2.SummaryRequest(
                    ticket_id=TICKET_ID,
                    history=turns(("user", "hi")),
                    triggered_by_escalation=True,
                ),
                FakeServicerContext(tenant_a.outsider()),
            )


class TestClassify:
    async def test_routes_to_a_department_the_caller_actually_HAS(
        self, servicer, tenant_a, generator
    ):
        generator.answer = json.dumps(
            {
                "department_id": tenant_a.department_a,
                "priority": "HIGH",
                "confidence": 0.7,
            }
        )

        response = await servicer.Classify(
            rag_pb2.ClassifyRequest(
                ticket_id=TICKET_ID,
                title="Cannot log in",
                body="Password reset loops",
                departments=[
                    rag_pb2.DepartmentOption(id=tenant_a.department_a, name="IT"),
                ],
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert response.suggested_department_id == tenant_a.department_a
        assert response.suggested_priority == "HIGH"

    async def test_DROPS_a_department_id_the_model_invented(
        self, servicer, tenant_a, generator
    ):
        # A suggestion naming a department that does not exist is worse than no
        # suggestion: it either fails a write or silently routes a ticket
        # nowhere. The caller sees an empty suggestion and leaves it unrouted,
        # which is the honest outcome.
        generator.answer = json.dumps(
            {"department_id": "made-up", "priority": "HIGH", "confidence": 0.9}
        )

        response = await servicer.Classify(
            rag_pb2.ClassifyRequest(
                ticket_id=TICKET_ID,
                title="t",
                body="b",
                departments=[
                    rag_pb2.DepartmentOption(id=tenant_a.department_a, name="IT"),
                ],
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert response.suggested_department_id == ""

    async def test_DROPS_a_priority_outside_the_domains_own_set(
        self, servicer, tenant_a, generator
    ):
        # "URGENT!!" is not a priority. Storing it would produce a ticket no
        # filter matches and no dashboard counts.
        generator.answer = json.dumps(
            {"department_id": tenant_a.department_a, "priority": "URGENT!!", "confidence": 1}
        )

        response = await servicer.Classify(
            rag_pb2.ClassifyRequest(
                ticket_id=TICKET_ID,
                title="t",
                body="b",
                departments=[
                    rag_pb2.DepartmentOption(id=tenant_a.department_a, name="IT"),
                ],
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert response.suggested_priority == ""

    async def test_REFUSES_at_the_cap(self, servicer, tenant_a, at_cap):
        request = rag_pb2.ClassifyRequest(ticket_id=TICKET_ID, title="t", body="b")
        context = FakeServicerContext(tenant_a.outsider())

        with pytest.raises(FakeAbort) as raised:
            await servicer.Classify(request, context)

        assert "[http:402]" in raised.value.details


class TestSuggest:
    async def test_returns_at_most_three_suggestions(
        self, servicer, tenant_a, generator
    ):
        generator.answer = json.dumps(
            [
                {"title": f"Step {index}", "body": "do it", "confidence": 0.5}
                for index in range(6)
            ]
        )

        response = await servicer.Suggest(
            rag_pb2.SuggestionsRequest(
                ticket_id=TICKET_ID, history=turns(("user", "help"))
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert len(response.suggestions) == 3

    async def test_a_MALFORMED_response_yields_no_suggestions_rather_than_a_500(
        self, servicer, tenant_a, generator
    ):
        # The request already cost money. Failing it because the model wrapped
        # its JSON in prose would lose the spend as well as the answer.
        generator.answer = "Here are some ideas, but not as JSON."

        response = await servicer.Suggest(
            rag_pb2.SuggestionsRequest(
                ticket_id=TICKET_ID, history=turns(("user", "help"))
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert list(response.suggestions) == []

    async def test_an_unreadable_confidence_defaults_to_ZERO_not_one(
        self, servicer, tenant_a, generator
    ):
        # A UI that hides low-confidence suggestions must hide the ones whose
        # confidence could not be read. Defaulting to 1 would promote exactly
        # the malformed responses.
        generator.answer = json.dumps(
            [{"title": "Step", "body": "do it", "confidence": "very"}]
        )

        response = await servicer.Suggest(
            rag_pb2.SuggestionsRequest(
                ticket_id=TICKET_ID, history=turns(("user", "help"))
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert response.suggestions[0].confidence_score == 0.0

    async def test_REFUSES_at_the_cap(self, servicer, tenant_a, at_cap):
        request = rag_pb2.SuggestionsRequest(ticket_id=TICKET_ID)
        context = FakeServicerContext(tenant_a.outsider())

        with pytest.raises(FakeAbort) as raised:
            await servicer.Suggest(request, context)

        assert "[http:402]" in raised.value.details


def _quota_key(tenant) -> str:
    from datetime import datetime, timezone

    from rag_service.ledger.quota import quota_counter_key

    return quota_counter_key(
        tenant.organization_id, datetime(2026, 8, 1, tzinfo=timezone.utc)
    )
