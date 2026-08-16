"""§2.2-2.3 — hybrid retrieval, fusion, and `Search` as the TEST SEAM.

Why this endpoint exists at all: it is the only point where isolation and
relevance can be proven cheaply, deterministically, and with no model in the
loop. Once generation is layered on, these tests become slow, non-deterministic
and — the real outcome — skipped.

So every isolation assertion in `test_tenant_scope_e2e.py` is made again HERE,
through the servicer, against the real Qdrant and the real Postgres. Passing at
the arm level proves the arms filter; passing here proves nothing above them
undid it.
"""

from __future__ import annotations

import pytest

from rag_service.generated.synapsedesk.rag import rag_pb2
from rag_service.retrieval.arms import RetrievedChunk
from rag_service.retrieval.fusion import RRF_K, reciprocal_rank_fusion
from tests.conftest import FakeServicerContext
from tests.fakes import FakeAbort

SHARED_TEXT = "annual leave carryover policy"


class TestSearchIsolation:
    """The §2.1 assertions, re-made through the endpoint — 13-doc §2.3 test 2."""

    async def test_never_returns_another_tenants_chunk(
        self, search, seed, tenant_a, tenant_b
    ):
        mine = await seed(tenant_a.organization_id, text=SHARED_TEXT)
        theirs = await seed(tenant_b.organization_id, text=SHARED_TEXT)

        response = await search(SHARED_TEXT, tenant_a.outsider())
        ids = {chunk.chunk_id for chunk in response.chunks}

        assert mine.chunk_id in ids
        assert theirs.chunk_id not in ids

    async def test_a_department_scoped_document_is_invisible_outside_it(
        self, search, seed, tenant_a
    ):
        await seed(
            tenant_a.organization_id,
            text=SHARED_TEXT,
            is_organization_wide=False,
            department_ids=[tenant_a.department_a],
        )

        response = await search(
            SHARED_TEXT, tenant_a.member_of(tenant_a.department_b)
        )

        assert list(response.chunks) == []

    async def test_a_soft_deleted_chunk_never_surfaces(self, search, seed, tenant_a):
        await seed(tenant_a.organization_id, text=SHARED_TEXT, is_deleted=True)

        response = await search(SHARED_TEXT, tenant_a.outsider())

        assert list(response.chunks) == []

    async def test_a_context_with_no_tenant_is_refused(self, search, tenant_a):
        # FAILED_PRECONDITION -> 400 at the gateway. Never an empty result set,
        # which a caller would read as "the corpus has nothing" rather than as
        # "this request was malformed".
        from rag_service.common.caller_context import CallerContext

        with pytest.raises(FakeAbort) as raised:
            await search(SHARED_TEXT, CallerContext(organization_id=None, sub="u"))

        assert raised.value.code.name == "FAILED_PRECONDITION"


class TestCitationPayload:
    """13-doc §2.3 test 1 — enough to render a citation, or it is not one."""

    async def test_returns_the_document_title_page_and_score(
        self, search, seed, tenant_a
    ):
        await seed(
            tenant_a.organization_id,
            text=SHARED_TEXT,
            title="Employee Handbook",
            page_number=4,
        )

        response = await search(SHARED_TEXT, tenant_a.outsider())

        assert len(response.chunks) == 1
        chunk = response.chunks[0]
        assert chunk.document_title == "Employee Handbook"
        assert chunk.page_number == 4
        assert chunk.content_text == SHARED_TEXT
        # The fusion key, and what a citation resolves through later.
        assert chunk.vector_point_id

    async def test_omits_the_page_for_a_format_that_has_none(
        self, search, seed, tenant_a
    ):
        # A DOCX has no pages until something paginates it. "Page 1" of a
        # fifty-page file is confidently wrong, and a user who clicks through
        # learns not to trust citations.
        await seed(tenant_a.organization_id, text=SHARED_TEXT, page_number=None)

        response = await search(SHARED_TEXT, tenant_a.outsider())

        assert not response.chunks[0].HasField("page_number")


class TestDegradedAtCap:
    """13-doc §2.3 tests 3-4 — degraded must mean CHEAPER, not relabelled."""

    async def test_at_cap_returns_200_with_lexical_only(
        self, search, seed, tenant_a, at_cap
    ):
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        response = await search(SHARED_TEXT, tenant_a.outsider())

        assert response.degraded == rag_pb2.SEARCH_DEGRADATION_LEXICAL_ONLY
        # A flat 402 would remove corpus diagnostics from a Knowledge Manager
        # at precisely the moment someone is working out what happened.
        assert len(response.chunks) == 1

    async def test_at_cap_makes_ZERO_embedding_calls(
        self, search, seed, tenant_a, at_cap, embeddings
    ):
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        await search(SHARED_TEXT, tenant_a.outsider())

        # The assertion that makes "degraded" mean something. A path that still
        # embedded and merely relabelled its response would pass every other
        # test in this class.
        assert embeddings.calls == []

    async def test_at_cap_writes_no_ledger_row(
        self, search, seed, tenant_a, at_cap, ledger
    ):
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        await search(SHARED_TEXT, tenant_a.outsider())

        assert ledger.entries == []

    async def test_the_degraded_path_STILL_enforces_the_boundary(
        self, search, seed, tenant_a, tenant_b, at_cap
    ):
        # The failure to avoid: a fallback that skips `tenant_scope()` because
        # it is "just keyword search".
        mine = await seed(tenant_a.organization_id, text=SHARED_TEXT)
        theirs = await seed(tenant_b.organization_id, text=SHARED_TEXT)

        response = await search(SHARED_TEXT, tenant_a.outsider())
        ids = {chunk.chunk_id for chunk in response.chunks}

        assert mine.chunk_id in ids
        assert theirs.chunk_id not in ids

    async def test_an_unreadable_counter_degrades_rather_than_serving_unmetered(
        self, search, seed, tenant_a, broken_redis
    ):
        # FAILS CLOSED. The gate is the one place a cache miss must not mean
        # "allow" — and here the cost of failing closed is a keyword search
        # rather than an error, which is why this path is worth having.
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        response = await search(SHARED_TEXT, tenant_a.outsider())

        assert response.degraded == rag_pb2.SEARCH_DEGRADATION_LEXICAL_ONLY


class TestMetering:
    """The normal path spends, and spending is recorded."""

    async def test_charges_and_records_the_query_embedding(
        self, search, seed, tenant_a, ledger, redis_client
    ):
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        await search(SHARED_TEXT, tenant_a.outsider())

        assert [entry.purpose for entry in ledger.entries] == ["EMBEDDING"]
        assert ledger.entries[0].prompt_tokens > 0

        keys = await redis_client.keys("quota:*")
        assert len(keys) == 1
        assert int(await redis_client.get(keys[0])) > 0

    async def test_embeds_through_the_model_the_settings_layer_resolved(
        self, search, seed, tenant_a, embeddings
    ):
        # Asserted rather than assumed — the whole layer is
        # worthless if one caller bypasses it.
        from rag_service.settings import EMBEDDING_MODEL

        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        await search(SHARED_TEXT, tenant_a.outsider())

        assert [model for _, model in embeddings.calls] == [EMBEDDING_MODEL]


class TestLimitClamp:
    async def test_clamps_an_absurd_limit_rather_than_refusing(
        self, search, seed, tenant_a
    ):
        # An unclamped limit is a direct path to enormous prompts downstream.
        # Clamped rather than rejected: the bound is a perfectly serviceable
        # answer, and refusing fails a user for a client-side mistake.
        for index in range(3):
            await seed(tenant_a.organization_id, text=f"{SHARED_TEXT} {index}")

        response = await search(SHARED_TEXT, tenant_a.outsider(), limit=10_000)

        assert len(response.chunks) <= 50

    async def test_a_zero_limit_falls_back_to_the_configured_default(
        self, search, seed, tenant_a
    ):
        from rag_service.settings import RETRIEVAL_DEFAULTS

        for index in range(8):
            await seed(tenant_a.organization_id, text=f"{SHARED_TEXT} {index}")

        response = await search(SHARED_TEXT, tenant_a.outsider(), limit=0)

        assert len(response.chunks) <= int(RETRIEVAL_DEFAULTS["final_context_k"])


class TestFusion:
    """§2.2 — RRF, and both of the corrections 11-doc §1.5 makes."""

    def _chunk(self, key: str) -> RetrievedChunk:
        return RetrievedChunk(
            vector_point_id=key, chunk_id=key, document_id="doc", score=1.0
        )

    def test_a_chunk_found_by_BOTH_arms_outranks_one_found_by_one(self):
        both = self._chunk("both")
        semantic_only = self._chunk("semantic-only")

        fused = reciprocal_rank_fusion(
            {
                "semantic": [semantic_only, both],
                "lexical": [both],
            },
            {"semantic": 1.0, "lexical": 1.0},
        )

        assert fused[0].chunk.vector_point_id == "both"
        assert fused[0].arms == ("semantic", "lexical")

    def test_weights_change_ORDERING_but_never_eligibility(self):
        # The correction: scaling `k` per arm truncates an arm's contribution
        # unpredictably, so a low-weighted arm could never surface its rank-8
        # result even when that result is the right one. Weighting belongs in
        # fusion, over a candidate set that already contains everything.
        semantic = self._chunk("s")
        lexical = self._chunk("l")
        arms = {"semantic": [semantic], "lexical": [lexical]}

        favour_semantic = reciprocal_rank_fusion(arms, {"semantic": 0.9, "lexical": 0.1})
        favour_lexical = reciprocal_rank_fusion(arms, {"semantic": 0.1, "lexical": 0.9})

        assert favour_semantic[0].chunk.vector_point_id == "s"
        assert favour_lexical[0].chunk.vector_point_id == "l"
        # Both candidates survive BOTH weightings — that is the whole point.
        assert len(favour_semantic) == len(favour_lexical) == 2

    def test_fuses_on_the_vector_point_id(self):
        # The common key. Fusing on `chunk_id` would work today and break the
        # moment one arm stopped carrying it — and the FTS query selects
        # `vector_point_id` precisely so this is a join rather than a lookup.
        same_point = RetrievedChunk(
            vector_point_id="point", chunk_id="chunk", document_id="doc", score=0.9
        )
        fused = reciprocal_rank_fusion(
            {"semantic": [same_point], "lexical": [same_point]},
            {"semantic": 1.0, "lexical": 1.0},
        )

        assert len(fused) == 1
        assert fused[0].score == pytest.approx(2 / (RRF_K + 1))

    def test_ties_break_DETERMINISTICALLY(self):
        # Two chunks at identical rank in both arms have identical fused
        # scores. Without a deterministic tiebreak the order depends on dict
        # iteration, so the same query returns a different top-k between runs
        # and every ordering assertion downstream is flaky for a reason nobody
        # can reproduce.
        first = self._chunk("aaa")
        second = self._chunk("bbb")

        one = reciprocal_rank_fusion({"semantic": [first, second]}, {"semantic": 1.0})
        two = reciprocal_rank_fusion({"semantic": [first, second]}, {"semantic": 1.0})

        assert [entry.chunk.vector_point_id for entry in one] == [
            entry.chunk.vector_point_id for entry in two
        ]


class TestRerankSkip:
    async def test_skips_the_cross_encoder_when_the_pool_is_already_small(
        self, search, seed, tenant_a, reranker
    ):
        # Per `reranking.md`: reordering five candidates when five are being
        # kept changes nothing about which chunks reach the prompt. For a
        # narrow-department user, whose pool is legitimately small, this is the
        # COMMON case rather than an edge one.
        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        await search(SHARED_TEXT, tenant_a.outsider())

        assert reranker.calls == []

    async def test_reranks_once_the_pool_exceeds_the_context_window(
        self, search, seed, tenant_a, reranker
    ):
        from rag_service.settings import RETRIEVAL_DEFAULTS

        for index in range(int(RETRIEVAL_DEFAULTS["final_context_k"]) + 3):
            await seed(tenant_a.organization_id, text=f"{SHARED_TEXT} {index}")

        await search(SHARED_TEXT, tenant_a.outsider())

        assert len(reranker.calls) == 1

    async def test_skip_rerank_bypasses_it_for_the_diagnostic_path(
        self, search, seed, tenant_a, reranker
    ):
        # What a Knowledge Manager uses to see what the RETRIEVER found before
        # the reranker had an opinion.
        from rag_service.settings import RETRIEVAL_DEFAULTS

        for index in range(int(RETRIEVAL_DEFAULTS["final_context_k"]) + 3):
            await seed(tenant_a.organization_id, text=f"{SHARED_TEXT} {index}")

        await search(SHARED_TEXT, tenant_a.outsider(), skip_rerank=True)

        assert reranker.calls == []


class TestUnderReturn:
    """§2.2 test 4 — "fewer than k" is NOT "nothing relevant"."""

    async def test_an_under_returning_arm_triggers_a_RELAXED_retry(
        self, servicer, seed, tenant_a, monkeypatch
    ):
        # A narrow-department user legitimately matches few points, and HNSW can
        # under-return even when more exist. Misreading that turns every
        # question from a small department into a false escalation — the most
        # user-visible way this pipeline fails.
        from rag_service.retrieval import service as retrieval_service

        await seed(tenant_a.organization_id, text=SHARED_TEXT)

        ef_values: list[int] = []
        original = retrieval_service.semantic_arm

        async def recording_arm(client, scope, vector, limit, hnsw_ef=128):
            ef_values.append(hnsw_ef)
            return await original(client, scope, vector, limit, hnsw_ef=hnsw_ef)

        monkeypatch.setattr(retrieval_service, "semantic_arm", recording_arm)

        response = await servicer.Search(
            rag_pb2.SearchRequest(query=SHARED_TEXT),
            FakeServicerContext(tenant_a.outsider()),
        )

        # One seeded chunk against a `top_n` of 20 is an under-return by
        # definition, so the relaxed retry must have run.
        assert ef_values == [
            retrieval_service.HNSW_EF_DEFAULT,
            retrieval_service.HNSW_EF_RELAXED,
        ]
        # And the result is still returned — the retry is a widening, not a
        # reason to conclude the corpus has nothing.
        assert len(response.chunks) == 1

    async def test_a_full_result_set_does_NOT_pay_for_a_retry(
        self, servicer, seed, tenant_a, monkeypatch
    ):
        # The retry costs a second vector search on every query if it is
        # unconditional. It fires only when the arm actually came back short.
        from rag_service.retrieval import service as retrieval_service
        from rag_service.settings import RETRIEVAL_DEFAULTS

        for index in range(int(RETRIEVAL_DEFAULTS["top_n"])):
            await seed(tenant_a.organization_id, text=f"{SHARED_TEXT} {index}")

        ef_values: list[int] = []
        original = retrieval_service.semantic_arm

        async def recording_arm(client, scope, vector, limit, hnsw_ef=128):
            ef_values.append(hnsw_ef)
            return await original(client, scope, vector, limit, hnsw_ef=hnsw_ef)

        monkeypatch.setattr(retrieval_service, "semantic_arm", recording_arm)

        await servicer.Search(
            rag_pb2.SearchRequest(query=SHARED_TEXT),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert ef_values == [retrieval_service.HNSW_EF_DEFAULT]


class TestExactPhrase:
    """§2.2 test 5 — the reason hybrid retrieval exists at all."""

    async def test_a_policy_number_the_embedding_blurs_is_found_LEXICALLY(
        self, servicer, seed, tenant_a, embeddings
    ):
        # "error 403" and "POL-2291" are the queries dense retrieval is worst
        # at: an embedding places them near every other error code and every
        # other policy number, because that is what they LOOK like. Exact
        # matching is what the lexical arm is for, and this test fails if
        # someone decides one arm is enough.
        #
        # The fake embedder is DETERMINISTIC from the text, so a query that
        # shares no words with the target chunk embeds nowhere near it — which
        # is precisely the blurring being simulated.
        target = await seed(
            tenant_a.organization_id,
            text="Refunds are governed by policy POL-2291 in all regions.",
        )
        for index in range(5):
            await seed(
                tenant_a.organization_id,
                text=f"Unrelated guidance number {index} about general matters.",
            )

        response = await servicer.Search(
            rag_pb2.SearchRequest(query="POL-2291"),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert target.chunk_id in {chunk.chunk_id for chunk in response.chunks}

    async def test_the_lexical_arm_still_runs_when_the_semantic_one_is_skipped(
        self, servicer, seed, tenant_a, at_cap
    ):
        # At the cap the exact-phrase path is the ONLY path — which is what
        # makes degrading to lexical-only a usable answer rather than a token
        # gesture.
        target = await seed(
            tenant_a.organization_id,
            text="Refunds are governed by policy POL-2291 in all regions.",
        )

        response = await servicer.Search(
            rag_pb2.SearchRequest(query="POL-2291"),
            FakeServicerContext(tenant_a.outsider()),
        )

        assert [chunk.chunk_id for chunk in response.chunks] == [target.chunk_id]
