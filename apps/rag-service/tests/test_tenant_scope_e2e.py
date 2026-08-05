"""§2.1 — the isolation tests, PER ARM.

The whole point of this file is the word "per arm". A test that queries hybrid
and passes proves nothing about *which* arm enforced the boundary: the vector
arm could be filtering correctly while the lexical one leaks, and fusion would
hide it because the leaked chunk simply appears among correct ones.

So every isolation assertion below is made twice — once against
`semantic_arm()` alone and once against `lexical_arm()` alone — and the two are
parametrized from one list so a new arm cannot be added without one.
"""

from __future__ import annotations

import uuid
from typing import ClassVar

import pytest

from rag_service.common.caller_context import (
    CallerContext,
    MissingTenantError,
)
from rag_service.qdrant.collection import (
    DEPARTMENT_IDS,
    IS_DELETED,
    IS_ORGANIZATION_WIDE,
    ORGANIZATION_ID,
    payload_index_fields,
)
from rag_service.retrieval.arms import lexical_arm, semantic_arm
from rag_service.retrieval.tenant_scope import tenant_scope

SHARED_TEXT = "annual leave carryover policy"


async def run_semantic(qdrant, pool, scope, query_vector):
    return await semantic_arm(qdrant, scope, query_vector, limit=50)


async def run_lexical(qdrant, pool, scope, query_vector):
    return await lexical_arm(pool, scope, SHARED_TEXT, limit=50)


#: Both arms, run alone. Parametrized so every assertion below is made twice.
ARMS = [
    pytest.param(run_semantic, id="semantic"),
    pytest.param(run_lexical, id="lexical"),
]


class TestCollection:
    """The preconditions the filter is worthless without."""

    async def test_every_filter_field_is_payload_indexed(self, qdrant):
        # Payload indexes are MANDATORY, not an optimisation (11-doc §1.4).
        # Without them Qdrant cannot estimate filter cardinality and falls back
        # to scanning — which returns correct answers, so nothing fails, and
        # the tenant filter quietly becomes the dominant cost of every query.
        fields = await payload_index_fields(qdrant)

        for field in (ORGANIZATION_ID, IS_DELETED, DEPARTMENT_IDS, IS_ORGANIZATION_WIDE):
            assert field in fields, f"{field} is not payload-indexed"


class TestTenantIsolation:
    """§2.1 tests 1-2 — org A's query never returns org B's points."""

    @pytest.mark.parametrize("run_arm", ARMS)
    async def test_never_returns_another_tenants_chunk(
        self, run_arm, qdrant, pool, seed, query_vector, tenant_a, tenant_b
    ):
        mine = await seed(tenant_a.organization_id, text=SHARED_TEXT)
        theirs = await seed(tenant_b.organization_id, text=SHARED_TEXT)

        results = await run_arm(
            qdrant, pool, tenant_scope(tenant_a.outsider()), query_vector
        )
        ids = {result.chunk_id for result in results}

        assert mine.chunk_id in ids
        assert theirs.chunk_id not in ids

    @pytest.mark.parametrize("run_arm", ARMS)
    async def test_a_tenant_with_no_documents_gets_nothing(
        self, run_arm, qdrant, pool, seed, query_vector, tenant_a, tenant_b
    ):
        # The complement of the test above, and it catches a filter that is
        # accidentally a no-op: seeding only the OTHER tenant means a broken
        # filter returns something, where the previous test would still pass by
        # finding the caller's own chunk among the leaked ones.
        await seed(tenant_b.organization_id, text=SHARED_TEXT)

        results = await run_arm(
            qdrant, pool, tenant_scope(tenant_a.outsider()), query_vector
        )

        assert results == []

    async def test_a_context_with_no_tenant_is_refused_outright(self):
        # Never a default and never an empty string: an empty tenant matches
        # nothing in Postgres but is a perfectly good Qdrant payload value, so a
        # silent fallback would produce a filter that quietly matched the wrong
        # partition rather than failing.
        with pytest.raises(MissingTenantError):
            tenant_scope(CallerContext(organization_id=None, sub="u"))

    async def test_a_super_admin_gets_no_bypass(self):
        # Deliberate, and the opposite of what `isSuperAdmin` does elsewhere in
        # this system. Retrieval output is an LLM answer, so a widened scope
        # does not SHOW an operator another tenant's document — it blends it
        # into prose that names no source. A super admin reads documents through
        # `GET /documents/:id`, where the disclosure is explicit and auditable.
        with pytest.raises(MissingTenantError):
            tenant_scope(
                CallerContext(organization_id=None, sub="u", is_super_admin=True)
            )


class TestDepartmentScoping:
    """§2.1 test 3 — a separate boundary from tenancy, and often the missed one."""

    @pytest.mark.parametrize("run_arm", ARMS)
    async def test_org_wide_is_visible_to_everyone(
        self, run_arm, qdrant, pool, seed, query_vector, tenant_a
    ):
        chunk = await seed(
            tenant_a.organization_id, text=SHARED_TEXT, is_organization_wide=True
        )

        results = await run_arm(
            qdrant, pool, tenant_scope(tenant_a.outsider()), query_vector
        )

        assert [result.chunk_id for result in results] == [chunk.chunk_id]

    @pytest.mark.parametrize("run_arm", ARMS)
    async def test_department_scoped_is_invisible_outside_it(
        self, run_arm, qdrant, pool, seed, query_vector, tenant_a
    ):
        # HR's salary bands must not surface for an IT agent in the SAME tenant.
        # A filter that stopped at `organization_id` would be perfectly
        # tenant-safe and would disclose exactly this.
        await seed(
            tenant_a.organization_id,
            text=SHARED_TEXT,
            is_organization_wide=False,
            department_ids=[tenant_a.department_a],
        )

        results = await run_arm(
            qdrant,
            pool,
            tenant_scope(tenant_a.member_of(tenant_a.department_b)),
            query_vector,
        )

        assert results == []

    @pytest.mark.parametrize("run_arm", ARMS)
    async def test_membership_of_ONE_department_is_enough(
        self, run_arm, qdrant, pool, seed, query_vector, tenant_a
    ):
        # Intersection semantics, not containment. Requiring the caller to be in
        # EVERY listed department would make multi-department scoping useless —
        # and it is the reading a naive `MatchAll` would give.
        chunk = await seed(
            tenant_a.organization_id,
            text=SHARED_TEXT,
            is_organization_wide=False,
            department_ids=[tenant_a.department_a, tenant_a.department_b],
        )

        results = await run_arm(
            qdrant,
            pool,
            tenant_scope(tenant_a.member_of(tenant_a.department_a)),
            query_vector,
        )

        assert [result.chunk_id for result in results] == [chunk.chunk_id]

    @pytest.mark.parametrize("run_arm", ARMS)
    async def test_a_caller_in_no_department_still_gets_org_wide(
        self, run_arm, qdrant, pool, seed, query_vector, tenant_a
    ):
        # The empty-list case, which is the easiest to break: an empty
        # `MatchAny` and an untyped empty `uuid[]` both misbehave, and both
        # would fail for exactly the caller who belongs to nothing.
        org_wide = await seed(
            tenant_a.organization_id, text=SHARED_TEXT, is_organization_wide=True
        )
        await seed(
            tenant_a.organization_id,
            text=SHARED_TEXT,
            is_organization_wide=False,
            department_ids=[tenant_a.department_a],
        )

        results = await run_arm(
            qdrant, pool, tenant_scope(tenant_a.outsider()), query_vector
        )

        assert [result.chunk_id for result in results] == [org_wide.chunk_id]


class TestSoftDelete:
    """The clause most often forgotten, because nothing visibly breaks."""

    @pytest.mark.parametrize("run_arm", ARMS)
    async def test_a_deleted_chunk_leaves_retrieval_immediately(
        self, run_arm, qdrant, pool, seed, query_vector, tenant_a
    ):
        live = await seed(tenant_a.organization_id, text=SHARED_TEXT)
        await seed(tenant_a.organization_id, text=SHARED_TEXT, is_deleted=True)

        results = await run_arm(
            qdrant, pool, tenant_scope(tenant_a.outsider()), query_vector
        )

        assert [result.chunk_id for result in results] == [live.chunk_id]


class TestBothRenderingsAgree:
    """The drift test — the one this whole design exists to make possible."""

    async def test_the_two_arms_return_the_SAME_set(
        self, qdrant, pool, seed, query_vector, tenant_a, tenant_b
    ):
        # Comparing like with like is only possible because `document_chunks`
        # carries the same four fields the Qdrant payload does. Before that
        # denormalisation the SQL side was a join through `documents` plus an
        # EXISTS against `department_documents` — structurally a different
        # query, which no test could meaningfully compare against a payload
        # filter.
        #
        # A fixture that exercises all four clauses at once, so a rendering that
        # dropped any ONE of them diverges here.
        visible_org_wide = await seed(tenant_a.organization_id, text=SHARED_TEXT)
        visible_in_dept = await seed(
            tenant_a.organization_id,
            text=SHARED_TEXT,
            is_organization_wide=False,
            department_ids=[tenant_a.department_a],
        )
        await seed(  # wrong department
            tenant_a.organization_id,
            text=SHARED_TEXT,
            is_organization_wide=False,
            department_ids=[tenant_a.department_b],
        )
        await seed(  # deleted
            tenant_a.organization_id, text=SHARED_TEXT, is_deleted=True
        )
        await seed(tenant_b.organization_id, text=SHARED_TEXT)  # wrong tenant

        scope = tenant_scope(tenant_a.member_of(tenant_a.department_a))
        semantic = await semantic_arm(qdrant, scope, query_vector, limit=50)
        lexical = await lexical_arm(pool, scope, SHARED_TEXT, limit=50)

        expected = {visible_org_wide.chunk_id, visible_in_dept.chunk_id}
        assert {result.chunk_id for result in semantic} == expected
        assert {result.chunk_id for result in lexical} == expected

    async def test_both_arms_key_on_the_SAME_fusion_id(
        self, qdrant, pool, seed, query_vector, tenant_a
    ):
        # 11-doc §1.5: Qdrant returns `vector_point_id` natively and the FTS
        # query SELECTs it, so fusion is a straight join rather than a second
        # lookup per candidate. If the two arms keyed differently, RRF would
        # dedup nothing and every chunk would appear twice.
        chunk = await seed(tenant_a.organization_id, text=SHARED_TEXT)

        scope = tenant_scope(tenant_a.outsider())
        semantic = await semantic_arm(qdrant, scope, query_vector, limit=50)
        lexical = await lexical_arm(pool, scope, SHARED_TEXT, limit=50)

        assert semantic[0].vector_point_id == chunk.vector_point_id
        assert lexical[0].vector_point_id == chunk.vector_point_id

    async def test_the_sql_rendering_interpolates_NOTHING(self, tenant_a):
        # The predicate is a constant string with positional parameters, which
        # is what makes "no injection here" checkable by reading rather than by
        # trusting. A caller-supplied department id containing SQL must reach
        # the database as data.
        hostile = "'; DROP TABLE document_chunks; --"
        scope = tenant_scope(tenant_a.member_of(hostile))

        assert hostile not in scope.sql_where
        assert hostile in scope.sql_args()[1]

    async def test_identical_contexts_render_identically(self, tenant_a):
        # Departments are sorted and deduplicated, so two equivalent contexts
        # produce byte-identical filters. These end up in cache keys and in test
        # assertions, and an order that varied with iteration would make both
        # flaky for no reason at all.
        one = tenant_scope(
            tenant_a.member_of(tenant_a.department_b, tenant_a.department_a)
        )
        two = tenant_scope(
            tenant_a.member_of(
                tenant_a.department_a, tenant_a.department_b, tenant_a.department_a
            )
        )

        assert one.sql_args() == two.sql_args()
        assert one.qdrant == two.qdrant


class TestLexicalArmSpecifics:
    """Things only the lexical arm can get wrong."""

    async def test_excludes_chunks_with_no_vector_point_id(
        self, qdrant, pool, seed, tenant_a
    ):
        # A chunk written by the pipeline but never upserted is not retrievable
        # from the semantic arm. Returning it from this one would make the two
        # arms disagree about what exists — and would surface a citation whose
        # vector never made it.
        # Written by hand rather than through `seed`, because `seed` always
        # supplies a `vector_point_id` — the absence is the whole point here.
        async with pool.acquire() as connection:
            document_id = await connection.fetchval(
                """
                INSERT INTO documents (
                    organization_id, created_by_id, title, file_url, file_type,
                    file_size_bytes, file_hash
                ) VALUES ($1::uuid, gen_random_uuid(), 'orphan', 'p', 'pdf', 1, $2)
                RETURNING id
                """,
                tenant_a.organization_id,
                str(uuid.uuid4()),
            )
            await connection.execute(
                """
                INSERT INTO document_chunks (
                    document_id, chunk_index, content_text, token_count,
                    organization_id, is_organization_wide, department_ids, is_deleted
                ) VALUES ($1::uuid, 0, $2, 10, $3::uuid, TRUE, '{}'::uuid[], FALSE)
                """,
                document_id,
                SHARED_TEXT,
                tenant_a.organization_id,
            )

        results = await lexical_arm(
            pool, tenant_scope(tenant_a.outsider()), SHARED_TEXT, limit=50
        )

        assert results == []

    async def test_matches_non_english_text(
        self, qdrant, pool, seed, tenant_a
    ):
        # The index uses `'simple'` because the corpus is multilingual — the
        # embedding model is. The `english` dictionary would stem and
        # stop-word non-English text into nonsense, and the failure would look
        # like "search does not work in French" rather than like a config bug.
        chunk = await seed(
            tenant_a.organization_id, text="politique de congés annuels"
        )

        results = await lexical_arm(
            pool, tenant_scope(tenant_a.outsider()), "congés", limit=50
        )

        assert [result.chunk_id for result in results] == [chunk.chunk_id]


class TestRescopeTakesEffectPerArm:
    """12-doc §2.3 test 2 and §2.4 test 1 — the SECURITY consequence, per arm.

    The fan-out's own tests prove both stores were written. These prove what
    that write means to a user: the document stops coming back.

    **Per arm, and that is the whole point.** A hybrid assertion cannot tell you
    WHICH store stopped serving it — the vector arm could be filtering correctly
    while the lexical one keeps returning a document the user just lost, and
    fusion would hide it because the leaked chunk simply appears among correct
    ones.
    """

    @pytest.mark.parametrize("run_arm", ARMS)
    async def test_losing_a_department_stops_retrieval_immediately(
        self, run_arm, qdrant, pool, seed, rescope, query_vector, tenant_a
    ):
        chunk = await seed(
            tenant_a.organization_id,
            text=SHARED_TEXT,
            is_organization_wide=False,
            department_ids=[tenant_a.department_a, tenant_a.department_b],
        )
        ctx = tenant_a.member_of(tenant_a.department_b)

        before = await run_arm(qdrant, pool, tenant_scope(ctx), query_vector)
        assert [result.chunk_id for result in before] == [chunk.chunk_id]

        # The restriction: department B is dropped. This is what the fan-out
        # writes — the same absolute scope, to both stores.
        await rescope(
            chunk,
            is_organization_wide=False,
            department_ids=[tenant_a.department_a],
        )

        after = await run_arm(qdrant, pool, tenant_scope(ctx), query_vector)
        assert after == []

    @pytest.mark.parametrize("run_arm", ARMS)
    async def test_turning_off_organization_wide_stops_retrieval(
        self, run_arm, qdrant, pool, seed, rescope, query_vector, tenant_a
    ):
        # The restriction an admin is most likely to make, and the one with the
        # widest blast radius: everyone outside the named departments loses it
        # at once.
        chunk = await seed(tenant_a.organization_id, text=SHARED_TEXT)
        ctx = tenant_a.outsider()

        assert await run_arm(qdrant, pool, tenant_scope(ctx), query_vector)

        await rescope(
            chunk,
            is_organization_wide=False,
            department_ids=[tenant_a.department_a],
        )

        assert await run_arm(qdrant, pool, tenant_scope(ctx), query_vector) == []

    @pytest.mark.parametrize("run_arm", ARMS)
    async def test_a_soft_delete_stops_retrieval(
        self, run_arm, qdrant, pool, seed, rescope, query_vector, tenant_a
    ):
        chunk = await seed(tenant_a.organization_id, text=SHARED_TEXT)
        ctx = tenant_a.outsider()

        assert await run_arm(qdrant, pool, tenant_scope(ctx), query_vector)

        await rescope(chunk, is_deleted=True)

        assert await run_arm(qdrant, pool, tenant_scope(ctx), query_vector) == []

    async def test_a_soft_deleted_chunk_is_STILL_RESOLVABLE_by_vector_point_id(
        self, pool, seed, rescope, tenant_a
    ):
        # 12-doc §2.4 test 2, and the reason delete FLIPS rather than removes:
        # citations in already-sent ticket messages must still resolve to their
        # chunk text (RDM §1.4, §1.6). A user reading last week's reply gets
        # the passage it quoted, not a broken link.
        chunk = await seed(tenant_a.organization_id, text=SHARED_TEXT)

        await rescope(chunk, is_deleted=True)

        async with pool.acquire() as connection:
            row = await connection.fetchrow(
                "SELECT content_text, is_deleted FROM document_chunks "
                "WHERE vector_point_id = $1::uuid",
                chunk.vector_point_id,
            )

        assert row is not None
        assert row["content_text"] == SHARED_TEXT
        assert row["is_deleted"] is True

    @pytest.mark.parametrize("run_arm", ARMS)
    async def test_a_GRANT_makes_it_retrievable_immediately(
        self, run_arm, qdrant, pool, seed, rescope, query_vector, tenant_a
    ):
        # The other direction, and it must work too — an admin who widens
        # access and then watches a user still fail to find the document has no
        # way to tell a slow fan-out from a broken one.
        chunk = await seed(
            tenant_a.organization_id,
            text=SHARED_TEXT,
            is_organization_wide=False,
            department_ids=[tenant_a.department_a],
        )
        ctx = tenant_a.outsider()

        assert await run_arm(qdrant, pool, tenant_scope(ctx), query_vector) == []

        await rescope(chunk, is_organization_wide=True, department_ids=[])

        after = await run_arm(qdrant, pool, tenant_scope(ctx), query_vector)
        assert [result.chunk_id for result in after] == [chunk.chunk_id]


class TestTheTwoRenderingsAgree:
    """§2.1 test 6 — the drift guard itself.

    Every other test in this file runs one arm and checks the answer. This one
    compares the two RENDERINGS against each other over a fixture covering all
    four clause combinations, which is the test that fails when someone edits
    one rendering and not the other.

    It is a meaningful comparison ONLY because both sides now read the same four
    columns. Before the denormalisation, the SQL side was a join through
    `documents` plus an `EXISTS` against `department_documents` — a structurally
    different query that no test could line up against a payload filter.
    """

    #: All four clauses, exercised together.
    #:
    #: Every row differs from every other in exactly one dimension, so a
    #: rendering that dropped ONE clause still fails — a fixture where the same
    #: chunks were excluded for two reasons at once would pass with either
    #: clause missing.
    #: `ClassVar`, because it is shared fixture DATA rather than per-instance
    #: state. Without the annotation a mutable class attribute is a standing
    #: invitation for one test to append to it and change what every later test
    #: runs — the bug RUF012 exists to catch.
    COMBINATIONS: ClassVar[list[tuple[str, dict[str, bool]]]] = [
        ("org-wide, live", {"is_organization_wide": True, "is_deleted": False}),
        ("org-wide, deleted", {"is_organization_wide": True, "is_deleted": True}),
        ("dept A, live", {"is_organization_wide": False, "is_deleted": False}),
        ("dept A, deleted", {"is_organization_wide": False, "is_deleted": True}),
    ]

    async def _both_renderings(self, qdrant, pool, ctx, query_vector):
        scope = tenant_scope(ctx)

        semantic = await semantic_arm(qdrant, scope, query_vector, limit=100)

        async with pool.acquire() as connection:
            rows = await connection.fetch(
                f"SELECT id::text AS chunk_id FROM document_chunks WHERE {scope.sql_where}",
                *scope.sql_args(),
            )

        return (
            {result.chunk_id for result in semantic},
            {row["chunk_id"] for row in rows},
        )

    async def test_both_select_the_SAME_SET_over_all_four_combinations(
        self, qdrant, pool, seed, query_vector, tenant_a
    ):
        seeded = {}
        for label, scope in self.COMBINATIONS:
            seeded[label] = await seed(
                tenant_a.organization_id,
                text=f"{SHARED_TEXT} {label}",
                department_ids=(
                    [] if scope["is_organization_wide"] else [tenant_a.department_a]
                ),
                **scope,
            )

        ctx = tenant_a.member_of(tenant_a.department_a)
        qdrant_set, sql_set = await self._both_renderings(
            qdrant, pool, ctx, query_vector
        )

        # Equal to each other — the drift guard — AND equal to the answer a
        # human would give. Only asserting they match each other would pass for
        # two renderings that are identically wrong.
        assert qdrant_set == sql_set
        assert qdrant_set == {
            seeded["org-wide, live"].chunk_id,
            seeded["dept A, live"].chunk_id,
        }

    async def test_both_agree_for_a_caller_in_NO_department(
        self, qdrant, pool, seed, query_vector, tenant_a
    ):
        org_wide = await seed(tenant_a.organization_id, text=SHARED_TEXT)
        await seed(
            tenant_a.organization_id,
            text=f"{SHARED_TEXT} scoped",
            is_organization_wide=False,
            department_ids=[tenant_a.department_a],
        )

        qdrant_set, sql_set = await self._both_renderings(
            qdrant, pool, tenant_a.outsider(), query_vector
        )

        assert qdrant_set == sql_set == {org_wide.chunk_id}

    async def test_both_agree_across_the_TENANT_boundary(
        self, qdrant, pool, seed, query_vector, tenant_a, tenant_b
    ):
        mine = await seed(tenant_a.organization_id, text=SHARED_TEXT)
        await seed(tenant_b.organization_id, text=SHARED_TEXT)

        qdrant_set, sql_set = await self._both_renderings(
            qdrant, pool, tenant_a.outsider(), query_vector
        )

        assert qdrant_set == sql_set == {mine.chunk_id}

    async def test_both_agree_on_MULTI_DEPARTMENT_intersection(
        self, qdrant, pool, seed, query_vector, tenant_a
    ):
        # `MatchAny` on one side, `&&` on the other. Two different operators
        # expressing one rule, which is exactly where a plausible-looking edit
        # turns intersection into containment on one side only.
        both = await seed(
            tenant_a.organization_id,
            text=SHARED_TEXT,
            is_organization_wide=False,
            department_ids=[tenant_a.department_a, tenant_a.department_b],
        )

        qdrant_set, sql_set = await self._both_renderings(
            qdrant, pool, tenant_a.member_of(tenant_a.department_b), query_vector
        )

        assert qdrant_set == sql_set == {both.chunk_id}
