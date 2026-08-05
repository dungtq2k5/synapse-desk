"""The four-clause retrieval boundary, rendered for both arms — 11-doc §1.4.

**This is the single most important function in Domain C.** Its failure mode is
silent cross-tenant disclosure inside an otherwise correct-looking answer:
nothing errors, nothing logs, and the response reads exactly as it should apart
from containing somebody else's document.

Elsewhere in this system a tenant boundary is a `WHERE` a reviewer can see. Here
it is a payload filter inside a vector query AND a predicate inside a full-text
query — one rule, expressed twice, in two query languages. That duplication is
the whole risk: someone adds a clause to the Qdrant filter, the SQL keeps the
old logic, and the lexical arm now returns what the semantic arm blocks.

The mitigation is structural rather than procedural:

  1. `document_chunks` carries the same four fields the Qdrant payload does
     (RDM Table 19), so both renderings compare **the same four fields** rather
     than one comparing a payload and the other joining three tables;
  2. both renderings come out of **one function, from one input**, so there is
     no call site at which they could be constructed independently.

Reviewing a retrieval change therefore means checking that this function was
called — not reading two filters and comparing them by eye.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from qdrant_client.http import models as qm

from rag_service.common.caller_context import CallerContext, require_tenant
from rag_service.qdrant.collection import (
    DEPARTMENT_IDS,
    IS_DELETED,
    IS_ORGANIZATION_WIDE,
    ORGANIZATION_ID,
)


@dataclass(frozen=True)
class TenantScope:
    """One rule, two renderings. Never construct either half at a call site."""

    qdrant: qm.Filter
    """For the semantic arm — passed as `query_filter`."""

    sql_where: str
    """For the lexical arm. Parameterised; interpolate nothing."""

    sql_params: dict[str, Any]
    """asyncpg uses positional `$1`-style parameters, so this is ordered by the
    numbering inside `sql_where` and passed with `*scope.sql_args()`."""

    def sql_args(self) -> list[Any]:
        """The params in `$1..$n` order, ready to splat into asyncpg."""
        return [self.sql_params[key] for key in sorted(self.sql_params)]


def tenant_scope(ctx: CallerContext) -> TenantScope:
    """The four clauses, for both arms.

    The clauses, and the one most often missed is NOT tenancy:

        organization_id == ctx.organization_id       # tenant
        AND is_deleted == False                      # soft delete leaves
                                                     # retrieval immediately
        AND ( is_organization_wide == True           # RDM §1.2 — department
              OR department_ids ∩ ctx.department_ids )  #   scoping

    Department scoping is a **separate boundary** from tenancy and cannot be
    folded into it: HR's salary bands must not surface for an IT agent in the
    same tenant, and a filter that stopped at `organization_id` would be
    perfectly tenant-safe while disclosing exactly that.

    A **super admin gets no bypass here.** Elsewhere in this system
    `isSuperAdmin` widens a scope, because a platform operator legitimately
    reads across tenants for support. Retrieval is different: the output is an
    LLM answer, so a widened scope does not show an operator another tenant's
    document — it silently blends it into generated prose that names no source.
    A super admin who needs to read a document uses `GET /documents/:id`, where
    the disclosure is explicit and auditable.
    """
    organization_id = require_tenant(ctx)

    # Deduplicated and ordered so two identical contexts produce two identical
    # filters — which matters because these end up in cache keys and in test
    # assertions, and an order that varied with dict iteration would make both
    # flaky for no reason.
    department_ids = sorted(set(ctx.department_ids))

    return TenantScope(
        qdrant=_qdrant_filter(organization_id, department_ids),
        sql_where=_sql_where(),
        sql_params={
            "p1_organization_id": organization_id,
            "p2_department_ids": department_ids,
        },
    )


def _qdrant_filter(organization_id: str, department_ids: list[str]) -> qm.Filter:
    """The semantic arm's rendering.

    The nested `Filter(should=[...])` inside `must=[...]` is valid Qdrant and is
    how an OR is expressed within an AND. `MatchAny` on an array payload gives
    **intersection** semantics — "the caller is in ANY of this document's
    departments" — which is the correct reading of RDM §1.2. Containment would
    require the caller to be in *every* listed department and make
    multi-department scoping useless.
    """
    visibility: list[qm.Condition] = [
        qm.FieldCondition(key=IS_ORGANIZATION_WIDE, match=qm.MatchValue(value=True)),
    ]

    # An empty `MatchAny` is not "match nothing" in every Qdrant version — it is
    # an edge case worth not relying on. A caller in no department simply gets
    # the org-wide clause alone, which is the correct result and is expressed
    # unambiguously.
    if department_ids:
        visibility.append(
            qm.FieldCondition(key=DEPARTMENT_IDS, match=qm.MatchAny(any=department_ids))
        )

    return qm.Filter(
        must=[
            qm.FieldCondition(
                key=ORGANIZATION_ID, match=qm.MatchValue(value=organization_id)
            ),
            qm.FieldCondition(key=IS_DELETED, match=qm.MatchValue(value=False)),
            qm.Filter(should=visibility),
        ]
    )


def _sql_where() -> str:
    """The lexical arm's rendering — the SAME four clauses, same four fields.

    `&&` is array overlap, which is the SQL equivalent of `MatchAny`'s
    intersection semantics. `document_chunks_dept_idx` is the GIN index that
    makes it cheap.

    `$2::uuid[]` is cast explicitly because asyncpg sends an empty Python list
    as an untyped array, and Postgres cannot infer the element type of `{}`
    against a `uuid[]` column — the query would fail for exactly the caller who
    belongs to no department, which is the easiest case to miss in testing.

    Parameterised throughout. Nothing here interpolates a caller-supplied value
    into SQL, and the fact that this returns a CONSTANT string is the property
    that makes that obvious at a glance.
    """
    return (
        "organization_id = $1 "
        "AND is_deleted = FALSE "
        "AND (is_organization_wide = TRUE OR department_ids && $2::uuid[])"
    )
