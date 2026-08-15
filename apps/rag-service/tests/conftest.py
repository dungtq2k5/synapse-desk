"""Fixtures that seed Qdrant and `document_chunks` DIRECTLY.

**Deliberately not via the ingestion worker** (13-doc §5). Read literally, the
two build orders deadlock: isolation tests need populated stores, and the
pipeline that populates them is built later in the other service. They do not
deadlock, because `tenant_scope()` is what is under test here — not ingestion —
and a fixture that depended on a PDF parser would break whenever the parser did,
for reasons having nothing to do with the boundary it was supposed to prove.

Both stores are written from ONE fixture call, because a test where the vector
arm and the lexical arm saw different data would prove nothing about whether
they enforce the same rule.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio
import redis.asyncio as redis
from dotenv import load_dotenv
from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qm

from rag_service.common.caller_context import CallerContext
from rag_service.config import load_config
from rag_service.generation.parts import Prompt, prompt_text
from rag_service.qdrant.collection import (
    COLLECTION_NAME,
    EMBEDDING_DIMENSION,
    ensure_collection,
)
from tests.fakes import FakeAbort

#: A fixed cycle start, so the quota key is stable across a run. A `now()`-based
#: one would put each test in its own key and quietly hide a counter that never
#: incremented.
_CYCLE_START = datetime(2026, 8, 1, tzinfo=timezone.utc)

_SERVICE_ROOT = Path(__file__).resolve().parents[1]

load_dotenv(_SERVICE_ROOT / ".env.test")


def _borrow_api_key_from_dev_env() -> None:
    """Fills in `GEMINI_API_KEY` from `.env` when `.env.test` has none.

    **One named key, not the whole file.** `load_dotenv(".env")` as a fallback
    would also fill in every OTHER value `.env.test` happens to omit — the dev
    Qdrant URL, the dev database — and a test suite silently pointed at a
    developer's own Postgres is a worse problem than the one being solved.

    **Why this exists at all:** the acceptance test for attachments
    (`test_multimodal_e2e.py`) needs a real cheap-tier call, and 36-doc's build
    order says the feature is finished when it passes. It skipped in every
    normal run because the credential lived one file over. Borrowing it here
    means the gate runs where the claim is made, without copying a secret into
    a second file.

    A real environment variable always wins — `load_dotenv` does not override
    one, and neither does this — so CI supplies its own and nothing here
    interferes.
    """
    if os.environ.get("GEMINI_API_KEY"):
        return

    dev_env = _SERVICE_ROOT / ".env"
    if not dev_env.exists():
        return

    for line in dev_env.read_text().splitlines():
        name, separator, value = line.partition("=")
        if separator and name.strip() == "GEMINI_API_KEY":
            os.environ["GEMINI_API_KEY"] = value.strip().strip("\"'")
            return


_borrow_api_key_from_dev_env()


@dataclass
class Tenant:
    """A tenant is a set of uuids — there is no organizations table here."""

    organization_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    department_a: str = field(default_factory=lambda: str(uuid.uuid4()))
    department_b: str = field(default_factory=lambda: str(uuid.uuid4()))

    def member_of(self, *department_ids: str) -> CallerContext:
        return CallerContext(
            organization_id=self.organization_id,
            sub=str(uuid.uuid4()),
            department_ids=list(department_ids),
        )

    def outsider(self) -> CallerContext:
        """A member of NO department — sees only organization-wide documents."""
        return CallerContext(
            organization_id=self.organization_id,
            sub=str(uuid.uuid4()),
            department_ids=[],
        )


@pytest.fixture
def config():
    return load_config()


@pytest_asyncio.fixture
async def qdrant(config):
    client = AsyncQdrantClient(url=config.qdrant_url)
    await ensure_collection(client)

    # Emptied between tests rather than dropped and recreated: recreating would
    # also recreate the payload indexes, so a test asserting they exist would
    # pass against a collection production never had.
    await client.delete(
        collection_name=COLLECTION_NAME,
        points_selector=qm.FilterSelector(filter=qm.Filter()),
        wait=True,
    )

    yield client
    await client.close()


@pytest_asyncio.fixture
async def pool(config):
    pool = await asyncpg.create_pool(
        config.ingestion_database_url, min_size=1, max_size=4
    )

    async with pool.acquire() as connection:
        await connection.execute("TRUNCATE TABLE documents CASCADE")

    yield pool
    await pool.close()


@dataclass(frozen=True)
class SeededChunk:
    chunk_id: str
    vector_point_id: str
    document_id: str
    text: str


@pytest_asyncio.fixture
async def seed(qdrant, pool):
    """Writes ONE chunk into BOTH stores, with identical scope fields.

    Identical by construction rather than by discipline: the arguments are used
    once and passed to both writes, so a test cannot accidentally create a
    document that is org-wide in Qdrant and department-scoped in Postgres —
    which is exactly the drift the whole design is guarding against, and would
    make a passing isolation test meaningless.
    """

    async def _seed(
        organization_id: str,
        *,
        text: str,
        department_ids: list[str] | None = None,
        is_organization_wide: bool = True,
        is_deleted: bool = False,
        document_id: str | None = None,
        title: str = "fixture",
        page_number: int | None = None,
        chunk_index: int = 0,
    ) -> SeededChunk:
        chunk_id = str(uuid.uuid4())
        vector_point_id = str(uuid.uuid4())
        document_id = document_id or str(uuid.uuid4())
        department_ids = department_ids or []

        # A deterministic non-zero vector. The CONTENT of the vector is
        # irrelevant to every test in this file — what is under test is the
        # filter, not similarity — but a zero vector is rejected by cosine
        # distance, so it cannot simply be zeros.
        vector = [0.1] * EMBEDDING_DIMENSION

        await qdrant.upsert(
            collection_name=COLLECTION_NAME,
            wait=True,
            points=[
                qm.PointStruct(
                    id=vector_point_id,
                    vector=vector,
                    payload={
                        "chunk_id": chunk_id,
                        "document_id": document_id,
                        "organization_id": organization_id,
                        "department_ids": department_ids,
                        "is_organization_wide": is_organization_wide,
                        "is_deleted": is_deleted,
                    },
                )
            ],
        )

        async with pool.acquire() as connection:
            # A parent row is required by the foreign key — but it is seeded
            # with DELIBERATELY CONTRADICTORY scope values.
            #
            # `documents` here always claims the chunk is organization-wide, in
            # no department and not deleted. The chunk row carries whatever the
            # test actually asked for. So a lexical query that reached the
            # boundary by JOINING through `documents` — the structurally
            # different query the denormalisation exists to eliminate — returns
            # visibly different results from one reading the denormalised
            # columns, and every isolation test below fails loudly instead of
            # passing for the wrong reason.
            await connection.execute(
                """
                INSERT INTO documents (
                    id, organization_id, created_by_id, title, file_url,
                    file_type, file_size_bytes, file_hash, is_organization_wide
                ) VALUES (
                    $1::uuid, $2::uuid, gen_random_uuid(), $4, 'p',
                    'pdf', 1, $3, TRUE
                )
                ON CONFLICT (id) DO NOTHING
                """,
                document_id,
                organization_id,
                str(uuid.uuid4()),
                title,
            )

            await connection.execute(
                """
                INSERT INTO document_chunks (
                    id, document_id, chunk_index, content_text, token_count,
                    vector_point_id, organization_id, is_organization_wide,
                    department_ids, is_deleted, page_number
                ) VALUES (
                    $1::uuid, $2::uuid, $10, $3, 10,
                    $4::uuid, $5::uuid, $6, $7::uuid[], $8, $9
                )
                """,
                chunk_id,
                document_id,
                text,
                vector_point_id,
                organization_id,
                is_organization_wide,
                department_ids,
                is_deleted,
                page_number,
                # **Parameterised so one DOCUMENT can have several chunks.** It
                # was hardcoded to 0, and `(document_id, chunk_index)` is
                # unique — so a fixture could not express the thing retrieval
                # actually returns, which is chunks rather than documents.
                chunk_index,
            )

        return SeededChunk(
            chunk_id=chunk_id,
            vector_point_id=vector_point_id,
            document_id=document_id,
            text=text,
        )

    return _seed


@pytest.fixture
def query_vector() -> list[float]:
    """Matches the seeded vectors, so similarity never filters anything out.

    Every test here asserts about the FILTER. A query vector that happened to
    rank a legitimate result below the cutoff would make an isolation test pass
    for entirely the wrong reason.
    """
    return [0.1] * EMBEDDING_DIMENSION


@pytest.fixture
def tenant_a() -> Tenant:
    return Tenant()


@pytest.fixture
def tenant_b() -> Tenant:
    """A SECOND tenant, always distinct.

    Two fixtures rather than one used twice, so a test cannot accidentally
    compare a tenant against itself and pass — which is the way an isolation
    test most commonly becomes vacuous.
    """
    return Tenant()


# ---------------------------------------------------------------------------
# The search fixtures — real everything except the two things that cost money
# ---------------------------------------------------------------------------
#
# The embedding client and the reranker are substituted; Qdrant, Postgres,
# Redis, `tenant_scope()`, the arms, fusion and hydration are all real. That
# split is deliberate: what these tests exist to prove is the boundary and the
# ranking, and both are real here. What they must not need is an API key, a
# network or per-run spend.


class FakeEmbeddingClient:
    """HONOURS the embedding contract — §2.3.

    A permissive fake would make every test here pass while production stayed
    broken in exactly the way the test claimed to cover. So this keeps the
    properties the pipeline depends on: the right dimensionality, a real token
    count, a DETERMINISTIC vector (so a retrieval assertion is reproducible
    rather than passing on whichever random vector landed nearest), and an
    exception on failure.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.fail_next: Exception | None = None

    async def embed_query(self, text: str, model: str):
        from rag_service.embeddings import EmbeddingResult

        self.calls.append((text, model))

        if self.fail_next is not None:
            error, self.fail_next = self.fail_next, None
            raise error

        return EmbeddingResult(
            vector=_deterministic_vector(text),
            prompt_tokens=max(1, len(text) // 4),
        )


def _deterministic_vector(text: str) -> list[float]:
    """Never all-zero: cosine distance is undefined for a zero vector and
    Qdrant rejects it, so a fake returning zeros would fail at the upsert for a
    reason having nothing to do with the test."""
    seed = 2_166_136_261
    for character in text:
        seed = ((seed ^ ord(character)) * 16_777_619) & 0xFFFFFFFF

    vector = []
    state = seed
    for _ in range(EMBEDDING_DIMENSION):
        state = (state * 1_664_525 + 1_013_904_223) & 0xFFFFFFFF
        vector.append(state / 4_294_967_296 + 0.001)

    return vector


class RecordingReranker:
    """Records that it was called and returns the candidates UNCHANGED.

    Unchanged rather than shuffled, because what the rerank tests assert is
    WHETHER it ran — the skip rule — and a substitute that reordered would make
    every downstream ordering assertion depend on a fake's opinion.

    It returns the same chunks, never a subset: a reranker that dropped
    candidates would silently change what "nothing above threshold" means, and
    that phrase is the difference between an answer and an escalation.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []

    def rerank(self, query: str, candidates: list):
        self.calls.append((query, len(candidates)))
        return list(candidates)


class RecordingLedger:
    """Captures ledger writes instead of making a gRPC call.

    Synchronous capture, but the entries are appended by the same call the real
    client makes — so a code path that forgot to record shows up as an empty
    list rather than as a passing test.
    """

    def __init__(self) -> None:
        self.entries: list = []

    def record(self, entry):
        self.entries.append(entry)

        # Returns an ID, like the real client does.
        #
        # It used to resolve to `None`, and that made the fake NOT substitutable
        # for `LedgerClient`: the reviewed-draft path awaits this task to learn
        # `generation_id`, so every draft in every test came back with an empty
        # one — and a test asserting the acceptance loop had something to join
        # on could not have been written.
        generation_id = str(uuid.uuid4())

        async def _recorded():
            return generation_id

        return asyncio.ensure_future(_recorded())

    # Mirrors LedgerClient.drain's signature deliberately — a fake that
    # dropped the parameter would not be substitutable for the real one. Same
    # suppression, same reason (see that docstring).
    async def drain(self, timeout: float = 5.0) -> None:  # noqa: ASYNC109  # NOSONAR S7483
        return None


@pytest.fixture
def embeddings() -> FakeEmbeddingClient:
    return FakeEmbeddingClient()


@pytest.fixture
def reranker() -> RecordingReranker:
    return RecordingReranker()


@pytest.fixture
def ledger() -> RecordingLedger:
    return RecordingLedger()


@pytest_asyncio.fixture
async def redis_client(config):
    client = redis.from_url(
        config.redis_url, db=config.redis_db, decode_responses=True
    )
    await client.flushdb()

    yield client
    await client.aclose()


@pytest.fixture
def budget_limit() -> dict:
    """The tenant's allowance, as a mutable box the `at_cap` fixture flips.

    A box rather than a parameter, so a test opts into the cap by requesting a
    fixture rather than by threading a value through every call.
    """
    return {"limit_micros": 2**62}


@pytest.fixture
def at_cap(budget_limit) -> None:
    """Puts the tenant AT the cap for this test."""
    budget_limit["limit_micros"] = 0


@pytest.fixture
def generator() -> ScriptedGenerator:
    """The generation provider, substituted.

    The retrieval suites never reach it — `Search` does no generation — but the
    servicer constructs it eagerly, so it has to be something. Making it a
    RECORDING fake rather than None means a retrieval test that accidentally
    triggered a generation fails loudly rather than on an AttributeError three
    frames away.
    """
    return ScriptedGenerator()


class ScriptedGenerator:
    """Streams a fixed answer, and records every call."""

    def __init__(self, answer: str = "The limit is 500 [1].") -> None:
        self.answer = answer
        self.calls: list[tuple[str, str]] = []
        #: Scripted one-shot answers for `generate`, consumed in order.
        #:
        #: Added when Layer 2 stopped having one possible answer: the fused
        #: classification (33-doc §3.3) can reply GREETING, FACTUAL or
        #: INJECTION, and a fake that always says FACTUAL cannot exercise the
        #: other two. Empty means the old behaviour.
        self.answers: list[str] = []
        #: Every prompt as given, parts included. `calls` keeps only the text,
        #: which cannot answer "did the file go?" — 36-doc §4.
        self.prompts: list[Prompt] = []
        self.fail_next: Exception | None = None

    async def stream(self, prompt: Prompt, model: str, max_output_tokens: int):
        from rag_service.generation.corag import GenerationDelta

        self.calls.append((prompt_text(prompt), model))
        self.prompts.append(prompt)

        size = max(1, len(self.answer) // 4)
        for start in range(0, len(self.answer), size):
            yield GenerationDelta(text=self.answer[start : start + size])

        yield GenerationDelta(done=True, prompt_tokens=800, completion_tokens=40)

    async def generate(self, prompt: Prompt, model: str, max_output_tokens: int):
        from rag_service.preprocess.pipeline import GenerationOutput

        self.calls.append((prompt_text(prompt), model))
        self.prompts.append(prompt)

        if self.fail_next is not None:
            error, self.fail_next = self.fail_next, None

            raise error

        text = self.answers.pop(0) if self.answers else "FACTUAL"

        return GenerationOutput(text=text, prompt_tokens=20, completion_tokens=2)


@pytest_asyncio.fixture
async def servicer(
    qdrant, pool, redis_client, embeddings, reranker, ledger, generator, budget_limit
):
    """The real servicer, with the two paid collaborators substituted."""
    from rag_service.server import Dependencies, RagServicer
    from rag_service.settings import AiSettingsResolver

    deps = Dependencies(
        qdrant=qdrant,
        pool=pool,
        redis=redis_client,
        embeddings=embeddings,
        reranker=reranker,
        generator=generator,
        ledger=ledger,
        settings=AiSettingsResolver(),
    )

    instance = RagServicer(deps)

    # The entitlement read is auth-service's in production. Overridden here for
    # the same reason the TypeScript suites spy on it: the allowance is the one
    # variable the budget tests exist to control.
    async def entitlement(organization_id: str):
        return _CYCLE_START, budget_limit["limit_micros"]

    instance._entitlement = entitlement  # type: ignore[method-assign]

    return instance


@pytest.fixture
def broken_redis(servicer):
    """Makes the quota read fail, so the gate's fail-closed path is exercised."""

    class Unreachable:
        async def get(self, *_args, **_kwargs):
            raise ConnectionError("redis is down")

        async def pipeline(self, *_args, **_kwargs):
            raise ConnectionError("redis is down")

    servicer._deps.redis = Unreachable()

    return servicer


@pytest.fixture
def search(servicer):
    """Calls `Search` the way gRPC would — metadata in, response out."""
    from rag_service.generated.synapsedesk.rag import rag_pb2

    async def _search(query: str, ctx, *, limit: int = 0, skip_rerank: bool = False):
        request = rag_pb2.SearchRequest(
            query=query, limit=limit, skip_rerank=skip_rerank
        )

        return await servicer.Search(request, FakeServicerContext(ctx))

    return _search


class FakeServicerContext:
    """A `grpc.aio.ServicerContext` stand-in that PACKS the context properly.

    It builds real metadata from a `CallerContext` and lets the servicer unpack
    it, rather than handing the servicer a context object directly. That keeps
    `unpack_caller_context` — the one place two languages agree on a wire
    format no compiler checks — inside the tested path.
    """

    def __init__(self, ctx) -> None:
        self._ctx = ctx

    def invocation_metadata(self):
        import json

        from rag_service.common.metadata import CONTEXT_METADATA

        pairs = [
            (CONTEXT_METADATA["department_ids"], json.dumps(self._ctx.department_ids)),
            (
                CONTEXT_METADATA["permission_codes"],
                json.dumps(self._ctx.permission_codes),
            ),
            (
                CONTEXT_METADATA["is_super_admin"],
                "true" if self._ctx.is_super_admin else "false",
            ),
        ]
        if self._ctx.organization_id:
            pairs.append(
                (CONTEXT_METADATA["organization_id"], self._ctx.organization_id)
            )
        if self._ctx.sub:
            pairs.append((CONTEXT_METADATA["user_id"], self._ctx.sub))

        return pairs

    async def abort(self, code, details):
        raise FakeAbort(code=code, details=details)


@pytest_asyncio.fixture
async def rescope(qdrant, pool):
    """Applies a scope change to BOTH stores, as the fan-out does.

    The TypeScript `ScopeWriterService` is what does this in production; this
    reproduces its EFFECT so the retrieval consequence can be tested here,
    where both arms can be run in isolation. It writes the same absolute scope
    to both stores — never a delta — which is the property that makes the real
    reconciler idempotent.
    """

    async def _rescope(
        chunk: SeededChunk,
        *,
        is_organization_wide: bool | None = None,
        department_ids: list[str] | None = None,
        is_deleted: bool | None = None,
    ) -> None:
        payload: dict[str, object] = {}
        if is_organization_wide is not None:
            payload["is_organization_wide"] = is_organization_wide
        if department_ids is not None:
            payload["department_ids"] = department_ids
        if is_deleted is not None:
            payload["is_deleted"] = is_deleted

        # A partial `set_payload`, exactly like the writer: a full overwrite
        # would drop `chunk_id`, and the symptom would be a citation failing to
        # resolve weeks later, far from the change that caused it.
        await qdrant.set_payload(
            collection_name=COLLECTION_NAME,
            payload=payload,
            points=[chunk.vector_point_id],
            wait=True,
        )

        assignments = ", ".join(
            f"{column} = ${index + 2}" for index, column in enumerate(payload)
        )
        values = [
            list(value) if isinstance(value, list) else value
            for value in payload.values()
        ]

        async with pool.acquire() as connection:
            await connection.execute(
                f"UPDATE document_chunks SET {assignments} WHERE id = $1::uuid",
                chunk.chunk_id,
                *values,
            )

    return _rescope
