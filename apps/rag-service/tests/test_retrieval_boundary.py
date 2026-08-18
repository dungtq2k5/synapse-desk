"""Every path that reaches retrieval goes through `tenant_scope()`.

The behaviour is already covered from the outside: `test_tenant_scope_e2e.py`
exercises both arms in isolation and the four-clause boundary over every
combination, and `test_visibility_agreement_e2e.py` proves the two arms agree.

What none of those can catch is a NEW retrieval path. The failure mode hardening
names is a fallback branch that skips the boundary because it is "just keyword
search" — and a fallback branch, by definition, only runs in the degraded
conditions the e2e tests are least likely to reproduce. It would ship green.

So this asserts the structure rather than the behaviour, from two directions:

  1. Every raw retrieval call — a Qdrant `query_points`, an FTS `to_tsvector` —
     lives in `arms.py`, which receives a `TenantScope` it did not build.
  2. Every servicer RPC that retrieves does so by calling the ONE service method
     that builds that scope.

The check is the one spelled as two greps, kept as a test because a
grep in a document is run once and a test is run every time.
"""

from __future__ import annotations

import ast
from pathlib import Path

import rag_service

SOURCE_ROOT = Path(rag_service.__file__).resolve().parent

# The primitives that actually touch a store. A retrieval path that avoids the
# boundary has to call one of these, so the list IS the attack surface.
RAW_RETRIEVAL_MARKERS = (
    "query_points",
    "to_tsvector",
    "websearch_to_tsquery",
)

# Where those primitives are permitted. `arms.py` takes a `TenantScope`
# parameter — it cannot construct one, which is what makes "reachable only
# through the boundary" a property of the code rather than of a convention.
RETRIEVAL_ARMS = "retrieval/arms.py"

# Deliberately not `retrieval/` — putting a raw query in a NEW file under that
# package is exactly the move this test exists to notice.
BOUNDARY_BUILDER = "retrieval/service.py"


def _python_sources() -> list[Path]:
    return sorted(
        path
        for path in SOURCE_ROOT.rglob("*.py")
        # Generated protobuf stubs are not hand-written and contain no queries.
        if "generated" not in path.parts and "__pycache__" not in path.parts
    )


def _relative(path: Path) -> str:
    return path.relative_to(SOURCE_ROOT).as_posix()


class TestRawRetrievalIsConfinedToTheArms:
    def test_no_module_outside_arms_queries_a_store_directly(self) -> None:
        offenders: dict[str, list[str]] = {}

        for path in _python_sources():
            relative = _relative(path)
            if relative == RETRIEVAL_ARMS:
                continue

            source = path.read_text(encoding="utf-8")
            # Comments and docstrings legitimately NAME these primitives while
            # explaining them — `service.py` does exactly that. Stripping them
            # keeps this a check on code rather than on prose.
            code = _strip_comments_and_docstrings(source)

            hits = [marker for marker in RAW_RETRIEVAL_MARKERS if marker in code]
            if hits:
                offenders[relative] = hits

        assert offenders == {}, (
            "A store is queried outside the retrieval arms, which means a path "
            "that may never pass through `tenant_scope()`: "
            f"{offenders}"
        )

    def test_the_arms_receive_a_scope_they_did_not_build(self) -> None:
        # The property that makes point 1 worth anything. If `arms.py` could
        # call `tenant_scope()` itself, "all queries live in arms.py" would say
        # nothing about which tenant they are scoped to.
        source = (SOURCE_ROOT / RETRIEVAL_ARMS).read_text(encoding="utf-8")
        code = _strip_comments_and_docstrings(source)

        assert "tenant_scope(" not in code
        assert "scope: TenantScope" in code


class TestEveryEntryPointGoesThroughTheBoundary:
    def test_the_scope_is_built_in_exactly_one_place(self) -> None:
        builders = [
            _relative(path)
            for path in _python_sources()
            if "tenant_scope(" in _strip_comments_and_docstrings(
                path.read_text(encoding="utf-8")
            )
            and _relative(path) != "retrieval/tenant_scope.py"
        ]

        assert builders == [BOUNDARY_BUILDER], (
            "`tenant_scope()` is called somewhere other than the single "
            f"retrieval entry point: {builders}"
        )

    def test_no_servicer_rpc_retrieves_without_it(self) -> None:
        # `Search`, `Chat`, the co-pilot RPCs and `Ask` must all reach retrieval
        # by the same call. Hardening singled out `Ask` because it has the most
        # machinery of its own — reformulation, a status enum, a handoff — and
        # is the likeliest to grow a private retrieval path.
        server = (SOURCE_ROOT / "server.py").read_text(encoding="utf-8")
        tree = ast.parse(server)

        retrieving = {
            node.name: node
            for node in ast.walk(tree)
            if isinstance(node, ast.AsyncFunctionDef)
            and any(
                isinstance(sub, ast.Attribute) and sub.attr == "retrieve"
                for sub in ast.walk(node)
            )
        }

        # A floor, so the scan cannot rot into passing because it found nothing:
        # Search, Chat, the co-pilot surface and Ask.
        assert len(retrieving) >= 4, (
            "Fewer retrieving RPCs than expected — the scan is probably looking "
            f"at the wrong tree: {sorted(retrieving)}"
        )

        for name, node in retrieving.items():
            calls = [
                sub
                for sub in ast.walk(node)
                if isinstance(sub, ast.Call)
                and isinstance(sub.func, ast.Attribute)
                and sub.func.attr == "retrieve"
            ]

            for call in calls:
                receiver = call.func.value  # type: ignore[union-attr]
                # Split in two so a failure NAMES which half broke: an
                # unexpected receiver shape and the wrong attribute are
                # different findings with different fixes.
                assert isinstance(receiver, ast.Attribute), (
                    f"{name} calls `.retrieve()` on an unexpected receiver shape"
                )
                assert receiver.attr == "_retrieval", (
                    f"{name} calls `.retrieve()` on `{receiver.attr}` rather than "
                    "the shared RetrievalService, so it may not build a tenant scope"
                )


def _strip_comments_and_docstrings(source: str) -> str:
    """Source with `#` comments and every docstring removed.

    Both of these files explain the primitives they are forbidden from calling,
    which is the right thing for them to do and would make a naive substring
    scan permanently red.
    """
    tree = ast.parse(source)

    for node in ast.walk(tree):
        if not isinstance(
            node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
        ):
            continue

        body = node.body
        if (
            body
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            body[0].value.value = ""

    # `ast.unparse` drops `#` comments for free, so the docstring blanking above
    # is the only part that needs doing by hand.
    return ast.unparse(tree)
