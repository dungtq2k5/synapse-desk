"""The ops surface on the Python peer — 23-doc §2, §3.

`rag-service` is `grpc.aio`-only, so before this there was no way for Kubernetes
to learn whether it was alive. The fix is the standard `grpc.health.v1.Health`
service on the port it already listens on — and the tests below are about the
two properties that make it worth having rather than merely present: that
readiness reflects THIS service's own dependencies, and that liveness reflects
nothing at all.
"""

from __future__ import annotations

from typing import Any, cast

import pytest
import pytest_asyncio
from grpc_health.v1 import _async as health_aio
from grpc_health.v1 import health_pb2

from rag_service.generated.synapsedesk.ops import ops_pb2
from rag_service.server import (
    READINESS_SERVICE,
    OpsServicer,
    _readiness_status,
    _refresh_readiness,
)

SERVING = health_pb2.HealthCheckResponse.SERVING
NOT_SERVING = health_pb2.HealthCheckResponse.NOT_SERVING


@pytest_asyncio.fixture
async def deps(qdrant, pool, redis_client, embeddings, reranker, ledger, generator):
    from rag_service.server import Dependencies
    from rag_service.settings import AiSettingsResolver

    return Dependencies(
        qdrant=qdrant,
        pool=pool,
        redis=redis_client,
        embeddings=embeddings,
        reranker=reranker,
        generator=generator,
        ledger=ledger,
        settings=AiSettingsResolver(),
    )


@pytest.mark.asyncio
async def test_readiness_is_serving_when_own_dependencies_are_up(deps):
    """1. Its OWN three: Qdrant, Postgres, Redis."""
    assert await _readiness_status(deps) == SERVING


@pytest.mark.asyncio
async def test_readiness_goes_red_when_qdrant_is_unreachable(deps):
    """2. **A dependency down means NOT_SERVING — and nothing more.**

    Readiness is the probe that removes this pod from rotation. Liveness, which
    would RESTART it, is deliberately never computed from any of this: a restart
    repairs nothing when the cause is a vector store, and doing it on every
    replica at once turns a degraded service into no service.
    """

    class Unreachable:
        async def get_collections(self):
            raise ConnectionError("qdrant is down")

    deps.qdrant = Unreachable()

    assert await _readiness_status(deps) == NOT_SERVING


@pytest.mark.asyncio
async def test_a_hanging_dependency_is_bounded(deps):
    """3. A wedged dependency answers NOT_SERVING rather than hanging.

    A dependency that has stopped answering usually accepts the connection and
    never replies. Unbounded, the refresh loop would block forever and leave the
    cached status at whatever it last was — reporting SERVING for the entire
    outage, which is the failure that looks exactly like health.
    """
    import asyncio

    class Wedged:
        async def get_collections(self):
            await asyncio.sleep(3600)

    deps.qdrant = Wedged()

    assert await _readiness_status(deps) == NOT_SERVING


@pytest.mark.asyncio
async def test_liveness_never_consults_a_dependency(deps):
    """4. **Liveness is set once and never recomputed.**

    Asserted on the refresh loop rather than on a return value: the property is
    that nothing in the readiness path can ever touch `""`. A loop that also
    refreshed liveness would be one dependency outage away from getting every
    container killed.
    """
    import asyncio

    servicer = health_aio.HealthServicer()
    await servicer.set("", SERVING)
    await servicer.set(READINESS_SERVICE, NOT_SERVING)

    class Unreachable:
        async def get_collections(self):
            raise ConnectionError("qdrant is down")

    deps.qdrant = Unreachable()

    task = asyncio.create_task(_refresh_readiness(deps, servicer))
    await asyncio.sleep(0.2)
    task.cancel()

    # Readiness reacted...
    # `cast(Any, None)` for the context: neither `Check` nor `GetVersion` reads
    # it, and building a real `ServicerContext` to satisfy a signature would add
    # a fake with no behaviour to assert on.
    no_context = cast(Any, None)

    readiness = await servicer.Check(
        health_pb2.HealthCheckRequest(service=READINESS_SERVICE), no_context
    )
    assert readiness is not None
    assert readiness.status == NOT_SERVING

    # ...and liveness did not.
    liveness = await servicer.Check(
        health_pb2.HealthCheckRequest(service=""), no_context
    )
    assert liveness is not None
    assert liveness.status == SERVING


@pytest.mark.asyncio
async def test_get_version_reports_the_baked_build(monkeypatch):
    """5. `/version`'s gRPC twin — 23-doc §3.

    Read from the environment, which is where the image bakes it. A container
    has no `.git`, so a runtime lookup returns nothing and the fallback is
    `"unknown"` — the answer you get at exactly the moment you need the real one.
    """
    monkeypatch.setenv("APP_VERSION", "1.2.3")
    monkeypatch.setenv("BUILD_SHA", "abc123")
    monkeypatch.setenv("BUILD_TIME", "2026-01-01T00:00:00Z")

    response = await OpsServicer().GetVersion(
        ops_pb2.VersionRequest(), cast(Any, None)
    )

    assert response.version == "1.2.3"
    assert response.sha == "abc123"
    assert response.built_at == "2026-01-01T00:00:00Z"


def test_readiness_checks_no_peer_service():
    """6. **No peer appears in the readiness path** — the rule, pinned.

    A grep-style assertion because the failure it guards against is a line
    somebody adds in good faith: a readiness probe that called ingestion-service
    would look correct, pass its own test, and only misbehave when that service
    is down — which is exactly when nobody wants to discover it. That is §1's
    cascade one level down.
    """
    import inspect
    import re

    # Docstrings and comments are stripped FIRST: they are where the rule is
    # explained, and they name every peer in order to say why none is checked.
    # Without this the test would fail on its own documentation.
    #
    # `inspect.getdoc` is not usable for the strip — it dedents, so it no longer
    # matches the indented text in the source.
    source = inspect.getsource(_readiness_status)
    body = re.sub(r'"""[\s\S]*?"""', '', source)
    body = re.sub(r'#.*$', '', body, flags=re.MULTILINE)

    for peer in ("ledger", "LedgerClient", "auth_", "grpc.aio.insecure"):
        assert peer not in body, f"readiness must not reference {peer}"
