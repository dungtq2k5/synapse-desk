"""The eval harness — 17-doc §3.

**Without this, every prompt change is a guess with a confident-sounding
rationale.** It does not need to be sophisticated; it needs to exist, and it
needs to be runnable before and after a change so the diff is the answer.

What it does, in order:

  1. Ingests `corpus/` into a throwaway tenant — real chunks, real embeddings,
     both stores — so retrieval is the real retrieval and not a stub.
  2. Asks every question in `golden.yaml` through `Ask`, the surface with the
     cleanest contract (one request, one status, one answer).
  3. Scores four metrics and prints a table.
  4. Deletes the tenant's data.

**Not in CI, deliberately** (17-doc §3.3). It costs money per run and it is
non-deterministic, and a flaky expensive test gets skipped within a fortnight
and deleted a month later. Run it on purpose: before and after a prompt change,
before a model version change, and when someone reports that the answers got
worse.

`npm run eval:rag`. Commit `eval/baseline.json` and diff against it — that diff
IS the answer to "did this prompt change help?", and it is the only form of that
answer worth having.

Two of the four metrics need no LLM judge at all — retrieval hit rate is an
assertion about the retrieved set, and refusal accuracy is an assertion about
`status`. That is what makes them cheap enough to run often, and they happen to
cover the two failures that matter most.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import asyncpg
import yaml
from dotenv import load_dotenv
from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qm

EVAL_DIR = Path(__file__).resolve().parent
SERVICE_ROOT = EVAL_DIR.parent

sys.path.insert(0, str(SERVICE_ROOT))

load_dotenv(SERVICE_ROOT / ".env")

from rag_service.config import load_config  # noqa: E402
from rag_service.embeddings import GeminiEmbeddingClient  # noqa: E402
from rag_service.generated.synapsedesk.rag import rag_pb2  # noqa: E402
from rag_service.qdrant.collection import (  # noqa: E402
    COLLECTION_NAME,
    EMBEDDING_DIMENSION,
    ensure_collection,
)
from rag_service.settings import EMBEDDING_MODEL  # noqa: E402

#: Small enough that a paragraph is one chunk, which keeps `must_cite`
#: meaningful: a chunk spanning three sections would make every question look
#: like a hit.
CHUNK_WORDS = 90


@dataclass
class Question:
    id: str
    category: str
    q: str
    language: str
    must_cite: list[str] = field(default_factory=list)
    must_contain: list[str] = field(default_factory=list)
    expect: str | None = None


@dataclass
class Outcome:
    question: Question
    status: str
    answer: str
    cited_documents: list[str]
    retrieved_documents: list[str]

    @property
    def retrieval_hit(self) -> bool | None:
        """Was the expected document in the final context?

        `None` for `DOC_MISSING` questions — there is no expected document, and
        counting them as misses would make the metric track the ratio of
        categories rather than retrieval quality.
        """
        if not self.question.must_cite:
            return None

        return any(
            document in self.retrieved_documents for document in self.question.must_cite
        )

    @property
    def cited_anything(self) -> bool | None:
        """Did the answer cite a source at all?

        The gap the bounds check cannot detect: an answer that reads as grounded
        and names nothing. Only meaningful where an answer was expected.
        """
        if self.question.expect == "DOC_MISSING":
            return None

        return bool(self.cited_documents)

    @property
    def refusal_correct(self) -> bool | None:
        """Did it refuse exactly when it should have?

        Both directions, because both are failures and only one is obvious:
        answering a `DOC_MISSING` question invents a policy, and refusing an
        answerable one is a deflection that silently did not happen.
        """
        expected_missing = self.question.expect == "DOC_MISSING"
        actually_missing = self.status == "DOC_MISSING"

        return expected_missing == actually_missing

    @property
    def language_match(self) -> bool | None:
        """Did the answer come back in the question's language?

        17-doc §2.1. Skipped for refusals, whose text is a fixed canned string
        in one language — measuring it there would score the constant.
        """
        if self.status == "DOC_MISSING" or not self.answer.strip():
            return None

        return detect_language(self.answer) == self.question.language

    @property
    def markdown_structured(self) -> bool | None:
        """Did the answer come back with markdown STRUCTURE — 21-doc §1, test 1.

        **Structure, never an exact string.** The wording of every answer here
        changes with the model version; asserting on it produces a test that
        fails for no reason and gets deleted rather than fixed. A bullet or a
        numbered item at line start is durable.

        Only meaningful for questions whose answer has steps or options to
        list — a one-line "5 days" answer is correctly unstructured, and
        demanding a bullet there would measure verbosity.
        """
        if self.status == "DOC_MISSING" or not self.answer.strip():
            return None
        if self.question.category != "ambiguous":
            return None

        return any(
            line.lstrip().startswith(("- ", "* ", "+ "))
            or re.match(r"^\s*\d+[.)]\s", line)
            for line in self.answer.splitlines()
        )

    @property
    def renders_as_markdown(self) -> bool | None:
        """The two failures that make an answer UNREADABLE — 21-doc §1, tests 2-3.

        Both are things models do unprompted when asked for markdown, and both
        are total rather than cosmetic:

          - wrapping the WHOLE answer in one fence turns the entire reply into
            an unrendered grey block
          - a heading inside a chat bubble that already sits under a page
            heading breaks the document outline and is enormous in most themes

        Checked on every answered question, because neither depends on what was
        asked.
        """
        if self.status == "DOC_MISSING" or not self.answer.strip():
            return None

        answer = self.answer.strip()

        wrapped_in_a_fence = answer.startswith("```") and answer.endswith("```")
        has_heading = any(
            line.lstrip().startswith("#") for line in answer.splitlines()
        )

        return not wrapped_in_a_fence and not has_heading

    @property
    def contains_expected(self) -> bool | None:
        if not self.question.must_contain:
            return None

        return all(
            needle.lower() in self.answer.lower()
            for needle in self.question.must_contain
        )


def detect_language(text: str) -> str:
    """Best-effort language identification.

    `langdetect` if it is installed, and a small marker-word fallback if it is
    not — because a harness that cannot run without an optional dependency is a
    harness that does not get run.

    Both are approximate, and that is acceptable: the metric is a RATE compared
    against a previous run, so a consistent misclassification cancels out. What
    it has to catch is the regression where a whole category flips to English.
    """
    try:
        from langdetect import DetectorFactory, detect

        # Deterministic, so two runs of the same answers score the same.
        DetectorFactory.seed = 0

        return detect(text)
    except Exception:
        # Total on purpose: `langdetect` raises on short or symbol-only text,
        # and a metric that crashed the harness would cost the whole run.
        return _language_by_markers(text)


#: Function words that are common, short, and do not appear in the others.
_LANGUAGE_MARKERS = {
    "vi": (" của ", " được ", " bạn ", " ngày ", " không "),
    "es": (" el ", " la ", " de ", " para ", " puede "),
    "fr": (" le ", " la ", " des ", " vous ", " est "),
    "de": (" der ", " die ", " das ", " sie ", " kann "),
    "en": (" the ", " you ", " and ", " your ", " is "),
}


def _language_by_markers(text: str) -> str:
    lowered = f" {text.lower()} "
    scores = {
        language: sum(lowered.count(marker) for marker in markers)
        for language, markers in _LANGUAGE_MARKERS.items()
    }
    best = max(scores, key=lambda language: scores[language])

    return best if scores[best] > 0 else "unknown"


def chunk_markdown(text: str) -> list[str]:
    """Paragraph-ish chunks, on blank lines then on length.

    Nothing like the production chunker on purpose — this is a fixture, and a
    fixture that imported ingestion-service's TypeScript chunker would couple
    the eval to a service it is not evaluating.
    """
    chunks: list[str] = []

    for block in (b.strip() for b in text.split("\n\n")):
        if not block:
            continue

        words = block.split()
        for start in range(0, len(words), CHUNK_WORDS):
            chunks.append(" ".join(words[start : start + CHUNK_WORDS]))

    return chunks


async def embed_documents(api_key: str, texts: list[str]) -> list[list[float]]:
    """Corpus vectors, with `task_type="RETRIEVAL_DOCUMENT"`.

    **Not `GeminiEmbeddingClient`**, which embeds with `RETRIEVAL_QUERY` — that
    asymmetry is the point of its module docstring, and it is production-correct:
    rag-service only ever embeds questions, and ingestion-service (TypeScript)
    embeds the corpus with the document task type.

    Embedding the corpus with the QUERY type here would evaluate a retrieval
    configuration that production never runs, and it would score slightly worse
    for a reason having nothing to do with any prompt change.
    """
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    vectors: list[list[float]] = []

    for text in texts:
        response = await client.aio.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=text,
            config=types.EmbedContentConfig(
                task_type="RETRIEVAL_DOCUMENT",
                output_dimensionality=EMBEDDING_DIMENSION,
            ),
        )
        embeddings = response.embeddings or []
        if not embeddings or not embeddings[0].values:
            raise RuntimeError(f"No vector for corpus chunk: {text[:40]!r}")

        vectors.append(list(embeddings[0].values))

    return vectors


async def ingest_corpus(pool, qdrant, api_key: str, organization_id: str) -> None:
    """The corpus into both stores, with identical scope fields.

    Written from ONE loop for the same reason the test fixture is: a document
    that was org-wide in Qdrant and department-scoped in Postgres would make
    every retrieval number meaningless.
    """
    # Sorted so two runs ingest in the same order. Retrieval scores are compared
    # against a baseline, and ties broken by insertion order would move the
    # numbers for a reason that has nothing to do with a prompt change.
    documents = sorted((EVAL_DIR / "corpus").glob("*.md"))

    for path in documents:
        document_id = str(uuid.uuid4())
        texts = chunk_markdown(path.read_text(encoding="utf-8"))
        vectors = await embed_documents(api_key, texts)

        async with pool.acquire() as connection:
            await connection.execute(
                """
                INSERT INTO documents (
                    id, organization_id, created_by_id, title, file_url,
                    file_type, file_size_bytes, content_hash, status,
                    is_organization_wide
                )
                VALUES ($1, $2, $3, $4, $5, 'md', 0, $6, 'COMPLETED', true)
                """,
                document_id,
                organization_id,
                organization_id,
                path.name,
                f"eval/{path.name}",
                f"eval-{document_id}",
            )

            for index, (text, vector) in enumerate(zip(texts, vectors, strict=True)):
                chunk_id = str(uuid.uuid4())
                point_id = str(uuid.uuid4())

                await connection.execute(
                    """
                    INSERT INTO document_chunks (
                        id, document_id, organization_id, chunk_index,
                        content_text, token_count, vector_point_id,
                        is_organization_wide, department_ids, is_deleted
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, true, '{}', false)
                    """,
                    chunk_id,
                    document_id,
                    organization_id,
                    index,
                    text,
                    len(text.split()),
                    point_id,
                )

                await qdrant.upsert(
                    collection_name=COLLECTION_NAME,
                    wait=True,
                    points=[
                        qm.PointStruct(
                            id=point_id,
                            vector=vector,
                            payload={
                                "chunk_id": chunk_id,
                                "document_id": document_id,
                                "organization_id": organization_id,
                                "department_ids": [],
                                "is_organization_wide": True,
                                "is_deleted": False,
                            },
                        )
                    ],
                )

    print(f"Ingested {len(documents)} documents into tenant {organization_id}")


async def teardown(pool, qdrant, organization_id: str) -> None:
    """Removes the throwaway tenant from BOTH stores.

    Qdrant lives outside the Postgres transaction, so it has to be said out
    loud: points left behind accumulate across runs and eventually change the
    retrieval numbers this harness exists to measure.
    """
    async with pool.acquire() as connection:
        await connection.execute(
            "DELETE FROM documents WHERE organization_id = $1", organization_id
        )

    await qdrant.delete(
        collection_name=COLLECTION_NAME,
        points_selector=qm.FilterSelector(
            filter=qm.Filter(
                must=[
                    qm.FieldCondition(
                        key="organization_id",
                        match=qm.MatchValue(value=organization_id),
                    )
                ]
            )
        ),
        wait=True,
    )


class EvalContext:
    """A minimal `grpc.aio.ServicerContext` — metadata in, aborts as errors."""

    def __init__(self, organization_id: str) -> None:
        self._organization_id = organization_id

    def invocation_metadata(self):
        return (
            ("x-organization-id", self._organization_id),
            ("x-user-id", str(uuid.uuid4())),
            ("x-department-ids", ""),
            ("x-is-super-admin", "false"),
        )

    async def abort(self, code, details):
        raise RuntimeError(f"aborted: {code} {details}")


async def ask_all(servicer, questions: list[Question], organization_id: str):
    outcomes: list[Outcome] = []

    for question in questions:
        response = await servicer.Ask(
            rag_pb2.ChatRequest(message=question.q),
            EvalContext(organization_id),
        )

        cited = [citation.document_title for citation in response.citations]

        outcomes.append(
            Outcome(
                question=question,
                status=rag_pb2.AnswerStatus.Name(response.status).removeprefix(
                    "ANSWER_STATUS_"
                ),
                answer=response.content,
                cited_documents=cited,
                # `Ask` returns only what it cited, so retrieval is measured
                # through citations. Noted rather than hidden: it makes the
                # retrieval metric a LOWER BOUND, and a lower bound that moves
                # is still the signal this exists for.
                retrieved_documents=cited,
            )
        )

        print(f"  {question.id:32} {outcomes[-1].status}")

    return outcomes


def rate(values: list[bool | None]) -> tuple[float, int]:
    """A rate over the questions where the metric APPLIES.

    `None` means "not applicable here" and is excluded from both numerator and
    denominator — averaging it in as a zero would make every metric drift with
    the mix of categories rather than with quality.
    """
    applicable = [value for value in values if value is not None]
    if not applicable:
        return (0.0, 0)

    return (sum(applicable) / len(applicable), len(applicable))


def report(outcomes: list[Outcome]) -> dict:
    metrics = {
        "retrieval_hit_rate": rate([o.retrieval_hit for o in outcomes]),
        "citation_rate": rate([o.cited_anything for o in outcomes]),
        "refusal_accuracy": rate([o.refusal_correct for o in outcomes]),
        "language_match": rate([o.language_match for o in outcomes]),
        "contains_expected": rate([o.contains_expected for o in outcomes]),
        # 21-doc §1. `renders_as_markdown` is the one that matters day to day:
        # a single-fenced answer or a heading in a chat bubble is unreadable
        # rather than merely untidy, and neither fails anything else.
        "renders_as_markdown": rate([o.renders_as_markdown for o in outcomes]),
        "markdown_structured": rate([o.markdown_structured for o in outcomes]),
    }

    print()
    print(f"{'metric':24} {'rate':>8} {'n':>5}")
    print("-" * 40)
    for name, (value, count) in metrics.items():
        print(f"{name:24} {value:8.1%} {count:5d}")

    failures = [
        o
        for o in outcomes
        if o.refusal_correct is False
        or o.retrieval_hit is False
        or o.language_match is False
        or o.contains_expected is False
        or o.renders_as_markdown is False
    ]

    if failures:
        print(f"\n{len(failures)} question(s) failed at least one metric:")
        for outcome in failures:
            reasons = []
            if outcome.refusal_correct is False:
                # Named first on purpose: 17-doc calls it the single most
                # damaging failure mode, because an invented policy is worse
                # than no answer every time.
                reasons.append(f"refusal (expected {outcome.question.expect or 'an answer'})")
            if outcome.retrieval_hit is False:
                reasons.append(f"retrieval (wanted {outcome.question.must_cite})")
            if outcome.language_match is False:
                reasons.append(f"language (wanted {outcome.question.language})")
            if outcome.contains_expected is False:
                reasons.append(f"content (wanted {outcome.question.must_contain})")
            if outcome.renders_as_markdown is False:
                reasons.append("markdown (fenced whole answer, or used a heading)")

            print(f"  {outcome.question.id:32} {'; '.join(reasons)}")

    return {
        name: {"rate": round(value, 4), "n": count}
        for name, (value, count) in metrics.items()
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description="Run the RAG eval golden set.")
    parser.add_argument(
        "--baseline",
        type=Path,
        default=EVAL_DIR / "baseline.json",
        help="Previous run to diff against.",
    )
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="Overwrite the baseline with this run. Do this deliberately.",
    )
    args = parser.parse_args()

    if not os.getenv("GEMINI_API_KEY"):
        print("GEMINI_API_KEY is not set — this harness calls the real model.")
        return 2

    questions = [
        Question(**entry)
        for entry in yaml.safe_load((EVAL_DIR / "golden.yaml").read_text())
    ]
    print(f"{len(questions)} questions\n")

    config = load_config()
    organization_id = str(uuid.uuid4())

    pool = await asyncpg.create_pool(config.ingestion_database_url, min_size=1)
    qdrant = AsyncQdrantClient(url=config.qdrant_url)
    await ensure_collection(qdrant)

    import redis.asyncio as redis

    from rag_service.generation.gemini import GeminiGenerator
    from rag_service.retrieval.rerank import FlashRankReranker
    from rag_service.server import Dependencies, RagServicer
    from rag_service.settings import AiSettingsResolver

    embeddings = GeminiEmbeddingClient(config.gemini_api_key)
    redis_client = redis.from_url(config.redis_url, db=config.redis_db, decode_responses=True)

    servicer = RagServicer(
        Dependencies(
            qdrant=qdrant,
            pool=pool,
            redis=redis_client,
            embeddings=embeddings,
            reranker=FlashRankReranker(),
            generator=GeminiGenerator(config.gemini_api_key),
            # A structural stand-in rather than a `LedgerClient`. The eval is
            # not a metering test, and thirty rows written to a tenant that is
            # about to be deleted would be noise the flag jobs reason about.
            ledger=_NullLedger(),  # type: ignore[bad-argument-type]
            settings=AiSettingsResolver(),
        )
    )

    # An unlimited allowance. The eval measures ANSWER quality; the budget gate
    # has its own suite, and a run that half-refused because it hit a cap would
    # look exactly like a quality regression.
    # `async` with nothing awaited, and REQUIRED rather than stylistic: this
    # replaces `RagServicer._entitlement`, which the servicer awaits directly
    # (`server.py` — `await self._entitlement(...)`). Dropping the keyword makes
    # that `await` raise "object tuple can't be used in 'await' expression" on
    # the first question the harness asks.
    async def entitlement(_organization_id: str):  # NOSONAR
        from datetime import datetime, timezone

        return datetime(2026, 1, 1, tzinfo=timezone.utc), 2**62

    servicer._entitlement = entitlement  # type: ignore[method-assign]

    try:
        await ingest_corpus(pool, qdrant, config.gemini_api_key, organization_id)
        print()
        outcomes = await ask_all(servicer, questions, organization_id)
        metrics = report(outcomes)
    finally:
        await teardown(pool, qdrant, organization_id)
        await redis_client.aclose()
        await qdrant.close()
        await pool.close()

    if args.baseline.exists():
        previous = json.loads(args.baseline.read_text())
        print("\nvs baseline:")
        for name, current in metrics.items():
            before = previous.get(name, {}).get("rate")
            if before is None:
                print(f"  {name:24}      new")
                continue

            delta = current["rate"] - before
            arrow = "▲" if delta > 0 else ("▼" if delta < 0 else "=")
            print(f"  {name:24} {arrow} {delta:+.1%}  ({before:.1%} → {current['rate']:.1%})")

    if args.write_baseline:
        args.baseline.write_text(json.dumps(metrics, indent=2) + "\n")
        print(f"\nBaseline written to {args.baseline}")

    return 0


class _NullLedger:
    """Records nothing.

    The eval is not a metering test, and writing thirty rows to a tenant that is
    about to be deleted would put noise in `ai_generations` that the flag jobs
    would then reason about.
    """

    def record(self, entry):
        # `async` is what makes this a COROUTINE, which is the only thing
        # `ensure_future` below accepts — a plain function returning a str
        # raises "a coroutine or an awaitable is required". Callers do
        # `asyncio.wait_for(asyncio.shield(task), ...)` on the result, so a Task
        # is the contract, not an implementation detail.
        async def _noop():  # NOSONAR
            return str(uuid.uuid4())

        return asyncio.ensure_future(_noop())

    # Awaited on shutdown (`await deps.ledger.drain()`), so the keyword is the
    # interface. A real `LedgerClient.drain` waits on its in-flight writes;
    # this one has none to wait for, which is what makes the body empty rather
    # than what makes the method synchronous.
    async def drain(self, timeout: float = 5.0) -> None:  # noqa: ASYNC109  # NOSONAR
        return None


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
