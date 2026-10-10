"""The two visibility predicates must AGREE.

`GET /documents` narrows with a Prisma `where` in TypeScript; retrieval narrows
with `tenant_scope()` in Python. They are the same rule — org-wide ∪ the
caller's departments, within the tenant, not deleted — written twice, in two
languages, against two different schemas.

**Both directions of disagreement are bugs, and only one of them gets
reported.** A document retrievable but not listed is a DISCLOSURE: it reaches
users inside AI answers while every screen insists it does not exist. A document
listed but not retrievable is a user saying search is broken. The first is
silent, which is why this test exists.

The `GET /documents` predicate is reproduced here as the SQL Prisma generates
for it, rather than being called over gRPC: what is under test is whether the
two rules select the same set, and a live-service test would also be testing two
services being up. This one fails for exactly one reason.
"""

from __future__ import annotations

import pytest

from rag_service.retrieval.tenant_scope import tenant_scope

#: The TypeScript side, transcribed.
#:
#: `visibilityScope()` in `documents.service.ts` emits, for a non-super-admin:
#:
#:     organizationId = ctx.organizationId
#:     AND deletedAt IS NULL
#:     AND (isOrganizationWide = true
#:          OR EXISTS (department_documents ∩ ctx.departmentIds))
#:
#: Transcribed rather than generated, and the transcription IS the risk this
#: test manages: if someone changes the Prisma predicate and not this string,
#: the test keeps passing. What it still catches is the far more likely change —
#: someone editing `tenant_scope()`, which is the security-critical half and the
#: one that has two renderings of its own to keep in step.
DOCUMENTS_LIST_SQL = """
    SELECT d.id::text
    FROM documents d
    WHERE d.organization_id = $1
      AND d.deleted_at IS NULL
      AND (
        d.is_organization_wide = TRUE
        OR EXISTS (
          SELECT 1 FROM department_documents dd
          WHERE dd.document_id = d.id AND dd.department_id = ANY($2::uuid[])
        )
      )
"""

#: The retrieval side, reached through `tenant_scope()`, rolled up to documents
#: so the two sets are comparable at all.
RETRIEVABLE_DOCUMENTS_SQL = """
    SELECT DISTINCT c.document_id::text
    FROM document_chunks c
    WHERE {where}
"""


async def listed_documents(pool, ctx) -> set[str]:
    async with pool.acquire() as connection:
        rows = await connection.fetch(
            DOCUMENTS_LIST_SQL, ctx.organization_id, list(ctx.department_ids)
        )

    return {row["id"] for row in rows}


async def retrievable_documents(pool, ctx) -> set[str]:
    scope = tenant_scope(ctx)

    async with pool.acquire() as connection:
        rows = await connection.fetch(
            RETRIEVABLE_DOCUMENTS_SQL.format(where=scope.sql_where),
            *scope.sql_args(),
        )

    return {row["document_id"] for row in rows}


@pytest.fixture
def scoped_seed(seed, pool):
    """Seeds a document whose CHUNKS and `department_documents` agree.

    The base `seed` fixture deliberately writes a contradictory parent row —
    that is what makes the isolation tests fail loudly rather than pass by
    joining. Here the two must agree, because agreement is the thing under
    test, so this fixture repairs the parent and adds the link rows the
    TypeScript predicate reads.
    """

    async def _seed(organization_id: str, **kwargs):
        chunk = await seed(organization_id, **kwargs)

        department_ids = kwargs.get("department_ids") or []
        is_organization_wide = kwargs.get("is_organization_wide", True)
        is_deleted = kwargs.get("is_deleted", False)

        async with pool.acquire() as connection:
            await connection.execute(
                """
                UPDATE documents
                SET is_organization_wide = $2,
                    deleted_at = CASE WHEN $3 THEN NOW() ELSE NULL END
                WHERE id = $1::uuid
                """,
                chunk.document_id,
                is_organization_wide,
                is_deleted,
            )

            for department_id in department_ids:
                await connection.execute(
                    """
                    INSERT INTO department_documents (document_id, department_id)
                    VALUES ($1::uuid, $2::uuid)
                    ON CONFLICT DO NOTHING
                    """,
                    chunk.document_id,
                    department_id,
                )

        return chunk

    return _seed


class TestVisibilityAgreement:
    async def test_the_same_fixture_selects_the_same_documents(
        self, pool, scoped_seed, tenant_a
    ):
        # All four scope combinations at once, so the comparison is over a set
        # rather than over one happy case.
        org_wide = await scoped_seed(tenant_a.organization_id, text="org wide")
        mine = await scoped_seed(
            tenant_a.organization_id,
            text="my department",
            is_organization_wide=False,
            department_ids=[tenant_a.department_a],
        )
        await scoped_seed(
            tenant_a.organization_id,
            text="another department",
            is_organization_wide=False,
            department_ids=[tenant_a.department_b],
        )
        await scoped_seed(
            tenant_a.organization_id, text="deleted", is_deleted=True
        )

        ctx = tenant_a.member_of(tenant_a.department_a)

        listed = await listed_documents(pool, ctx)
        retrievable = await retrievable_documents(pool, ctx)

        assert listed == retrievable
        assert listed == {org_wide.document_id, mine.document_id}

    async def test_neither_predicate_crosses_the_TENANT_boundary(
        self, pool, scoped_seed, tenant_a, tenant_b
    ):
        mine = await scoped_seed(tenant_a.organization_id, text="mine")
        theirs = await scoped_seed(tenant_b.organization_id, text="theirs")

        ctx = tenant_a.outsider()

        listed = await listed_documents(pool, ctx)
        retrievable = await retrievable_documents(pool, ctx)

        assert listed == retrievable == {mine.document_id}
        assert theirs.document_id not in retrievable

    async def test_a_caller_in_NO_department_sees_the_same_set_either_way(
        self, pool, scoped_seed, tenant_a
    ):
        # The zero-department case, and the easiest to get wrong on both sides
        # — an empty `IN ()` in SQL and an empty `MatchAny` in Qdrant both
        # misbehave, and they misbehave for exactly the caller who belongs to
        # nothing.
        org_wide = await scoped_seed(tenant_a.organization_id, text="org wide")
        await scoped_seed(
            tenant_a.organization_id,
            text="scoped",
            is_organization_wide=False,
            department_ids=[tenant_a.department_a],
        )

        ctx = tenant_a.outsider()

        listed = await listed_documents(pool, ctx)
        retrievable = await retrievable_documents(pool, ctx)

        assert listed == retrievable == {org_wide.document_id}

    async def test_a_SOFT_DELETED_document_leaves_both_sets(
        self, pool, scoped_seed, tenant_a
    ):
        # The two express deletion differently — `documents.deleted_at` on one
        # side, the denormalised `document_chunks.is_deleted` on the other —
        # so agreement here is not automatic. It is exactly what the fan-out
        # exists to maintain.
        live = await scoped_seed(tenant_a.organization_id, text="live")
        await scoped_seed(tenant_a.organization_id, text="gone", is_deleted=True)

        ctx = tenant_a.outsider()

        listed = await listed_documents(pool, ctx)
        retrievable = await retrievable_documents(pool, ctx)

        assert listed == retrievable == {live.document_id}

    async def test_a_document_in_SEVERAL_departments_needs_only_one_match(
        self, pool, scoped_seed, tenant_a
    ):
        # Intersection semantics on both sides. Requiring membership of EVERY
        # listed department would make multi-department scoping useless, and it
        # is the reading a naive `MatchAll` — or a naive `@>` — would give.
        document = await scoped_seed(
            tenant_a.organization_id,
            text="shared",
            is_organization_wide=False,
            department_ids=[tenant_a.department_a, tenant_a.department_b],
        )

        ctx = tenant_a.member_of(tenant_a.department_b)

        listed = await listed_documents(pool, ctx)
        retrievable = await retrievable_documents(pool, ctx)

        assert listed == retrievable == {document.document_id}
