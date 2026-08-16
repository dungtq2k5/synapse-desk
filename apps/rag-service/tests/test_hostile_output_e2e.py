"""17-doc §1.2 Gap 3 — the whole SYSTEM survives a hostile model response.

The parse sites are individually well covered (`_confidence` defaulting to zero,
the unparseable review, the bounds-checked `[n]` markers). What was missing is
the sweep: **one set of hostile responses fired at every generation RPC.**

Why the sweep is worth more than the six unit tests it overlaps. The current
behaviour is correct because six independent decisions each happened to be
right — not because a rule is enforced anywhere. The seventh parse site will be
written by someone who has read none of them, and the failure will not look like
a parse bug: it will look like a 500 on one surface, in one tenant, for one
malformed response nobody can reproduce.

Three properties, for every RPC and every hostile input:

  1. **It does not raise.** A model returning garbage is an ordinary Tuesday,
     not an incident.
  2. **The response is well formed.** A field the client reads must exist, even
     if empty — "not available" is a rendering, `None` is a crash in the caller.
  3. **The ledger row is still written.** The clause most likely to be missed: a
     malformed response is spend that ALREADY HAPPENED, and a parse failure that
     skips the ledger is a metering hole in the shape of a bug fix.

The invented-uuid case gets its own assertion, because its failure is a routing
error rather than an exception — and a routing error is the only one here that
could put a ticket in front of the wrong department, or a department belonging
to nobody.
"""

from __future__ import annotations

import uuid

import pytest

from rag_service.generated.synapsedesk.rag import rag_pb2
from tests.conftest import FakeServicerContext

TICKET_ID = "88888888-8888-4888-8888-888888888888"

#: A uuid that is syntactically perfect and semantically invented — the shape a
#: model produces when asked for an id and given none it likes.
INVENTED_DEPARTMENT_ID = str(uuid.uuid4())

REAL_DEPARTMENT_ID = "99999999-9999-4999-8999-999999999999"


#: Every way a model has been observed to answer badly, plus the two the
#: parsers were written against.
HOSTILE = [
    pytest.param("", id="empty"),
    pytest.param("I'm sorry, I can't help with that.", id="refusal-no-json"),
    pytest.param('```json\n{"summary":', id="truncated-mid-object"),
    # Gap 1: `re.search(r"\{.*\}",...)` with DOTALL spans from the
    # FIRST brace to the LAST, so two objects capture a span that is not valid
    # JSON and the caller gets an empty result with a good object inside the
    # text.
    pytest.param('{"summary": "a"} {"summary": "b"}', id="two-objects"),
    pytest.param("{'summary': 'single quotes'}", id="python-not-json"),
    pytest.param('{"confidence": "high"}', id="right-key-wrong-type"),
    pytest.param(
        '{"department_id": "' + INVENTED_DEPARTMENT_ID + '"}', id="invented-uuid"
    ),
    pytest.param("[]", id="array-where-object-expected"),
    pytest.param("\x00\x01\x02 � garbage", id="control-characters"),
    pytest.param("x" * 100_000, id="absurd-length"),
]


@pytest.fixture
def hostile_generator(generator, request):
    """Points the substituted provider at one hostile response.

    The fixture returns the SAME object the servicer already holds, so nothing
    has to be rewired — the servicer was built with this generator.
    """
    generator.answer = request.param

    return generator


def _turns(*pairs):
    return [
        rag_pb2.ConversationTurn(role=role, content=content) for role, content in pairs
    ]


async def _seed_a_source(seed, tenant):
    """One retrievable chunk, so retrieval succeeds and generation is REACHED.

    Without it every RPC would short-circuit on an empty retrieval and the
    sweep would prove only that the DOC_MISSING path works.
    """
    await seed(
        tenant.organization_id,
        text="Annual leave carries over up to five days into the next year.",
        is_organization_wide=True,
    )


class TestEveryGenerationRpcSurvivesAHostileResponse:
    @pytest.mark.parametrize("hostile_generator", HOSTILE, indirect=True)
    async def test_SUMMARIZE(self, servicer, seed, tenant_a, hostile_generator, ledger):
        await _seed_a_source(seed, tenant_a)

        response = await servicer.Summarize(
            rag_pb2.SummaryRequest(
                ticket_id=TICKET_ID,
                history=_turns(("user", "my printer is broken")),
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        # Well formed: every field the client reads exists. `summary_text` may
        # be empty — that renders as "not available" — but it must be a string.
        assert isinstance(response.summary_text, str)
        assert isinstance(response.suggested_action, str)
        # Defaults toward LESS confidence, never more. A default of 1 would
        # promote exactly the responses nobody could parse into the ones the UI
        # shows most prominently.
        assert 0.0 <= response.confidence_score <= 1.0
        assert ledger.entries, "spend happened and was not recorded"

    @pytest.mark.parametrize("hostile_generator", HOSTILE, indirect=True)
    async def test_CLASSIFY(self, servicer, seed, tenant_a, hostile_generator, ledger):
        await _seed_a_source(seed, tenant_a)

        response = await servicer.Classify(
            rag_pb2.ClassifyRequest(
                ticket_id=TICKET_ID,
                title="Printer offline",
                body="It has been offline since Monday.",
                departments=[
                    rag_pb2.DepartmentOption(id=REAL_DEPARTMENT_ID, name="IT Support")
                ],
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        # **The one hostile input whose failure is a ROUTING error rather than
        # an exception.** An unvalidated id would file the ticket into a
        # department that does not exist — or, if the candidate list ever came
        # from a wider query, one belonging to another tenant.
        assert response.suggested_department_id in {"", REAL_DEPARTMENT_ID}
        assert response.suggested_department_id != INVENTED_DEPARTMENT_ID
        assert 0.0 <= response.confidence_score <= 1.0
        assert ledger.entries, "spend happened and was not recorded"

    @pytest.mark.parametrize("hostile_generator", HOSTILE, indirect=True)
    async def test_SUGGEST(self, servicer, seed, tenant_a, hostile_generator, ledger):
        await _seed_a_source(seed, tenant_a)

        response = await servicer.Suggest(
            rag_pb2.SuggestionsRequest(
                ticket_id=TICKET_ID,
                history=_turns(("user", "how do I reset my password?")),
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        # An empty list is a fine answer. A malformed ENTRY is not — a
        # suggestion with no title renders as a blank button.
        for suggestion in response.suggestions:
            assert suggestion.title
            assert 0.0 <= suggestion.confidence_score <= 1.0
        assert ledger.entries, "spend happened and was not recorded"

    @pytest.mark.parametrize("hostile_generator", HOSTILE, indirect=True)
    async def test_DRAFT(self, servicer, seed, tenant_a, hostile_generator, ledger):
        await _seed_a_source(seed, tenant_a)

        response = await servicer.Draft(
            rag_pb2.DraftRequest(
                ticket_id=TICKET_ID,
                history=_turns(("user", "how much leave carries over?")),
            ),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert isinstance(response.draft, str)
        # The join the acceptance loop needs. Losing it to a parse failure
        # would silently stop outcome tracking on exactly the generations most
        # worth tracking.
        assert response.generation_id
        assert ledger.entries, "spend happened and was not recorded"

    @pytest.mark.parametrize("hostile_generator", HOSTILE, indirect=True)
    async def test_CHAT(self, servicer, seed, tenant_a, hostile_generator, ledger):
        await _seed_a_source(seed, tenant_a)

        frames = [
            frame
            async for frame in servicer.Chat(
                rag_pb2.ChatRequest(message="how much leave carries over?"),
                FakeServicerContext(tenant_a.outsider()),
            )
        ]

        # A stream that ends without a COMPLETION frame leaves the client
        # waiting — worse than a bad answer, because nothing tells it to stop.
        # `ChatChunk` is a oneof, so the terminal frame is the one carrying
        # `completion`.
        assert frames
        assert frames[-1].HasField("completion")
        assert frames[-1].completion.status != rag_pb2.ANSWER_STATUS_UNSPECIFIED
        assert ledger.entries, "spend happened and was not recorded"

    @pytest.mark.parametrize("hostile_generator", HOSTILE, indirect=True)
    async def test_ASK(self, servicer, seed, tenant_a, hostile_generator, ledger):
        await _seed_a_source(seed, tenant_a)

        response = await servicer.Ask(
            rag_pb2.ChatRequest(message="how much leave carries over?"),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert isinstance(response.content, str)
        # A status the client can branch on, always. `ANSWER_STATUS_UNSPECIFIED`
        # would send it down whichever branch it wrote first.
        assert response.status != rag_pb2.ANSWER_STATUS_UNSPECIFIED
        assert ledger.entries, "spend happened and was not recorded"
