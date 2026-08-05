"""The durable ledger row, written through `ingestion-service`.

`ai_generations` has ONE writer. Service-per-database means this service does
not reach into postgres_ingestion to append its own spend — it asks the owner,
over `AiLedgerService.RecordGeneration`.

**Every write here is shielded from cancellation**, and that is not defensive
habit: it closes a metering hole that hides inside the metering design. When a
user cancels a streamed answer, the request task is cancelled, and with
`asyncio.create_task` the cancellation propagates to children — so the ledger
write is exactly the thing that dies. Partial generation is real spend, and the
natural implementation is the one that fails to record it.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

import grpc

from rag_service.generated.synapsedesk.ingestion import ledger_pb2, ledger_pb2_grpc

logger = logging.getLogger(__name__)

#: Longer than a normal deadline would be, because this call is made AFTER the
#: work is done and its failure costs a ledger row rather than a response.
LEDGER_DEADLINE_SECONDS = 5.0


@dataclass
class GenerationEntry:
    organization_id: str
    purpose: str
    model_name: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    user_id: str | None = None
    ticket_id: str | None = None
    latency_ms: int | None = None
    status: str = "SUCCESS"
    content: str | None = None
    retrieved_chunk_ids: list[str] = field(default_factory=list)
    cited_chunk_ids: list[str] = field(default_factory=list)


class LedgerClient:
    """Fire-and-forget writes to the one ledger.

    Non-throwing by construction, matching the TypeScript `record()`: the
    generation already happened and already cost money, so failing a request
    because bookkeeping failed loses the work AND the money. Reconciliation
    fixes the drift, which is what makes this safe rather than sloppy.
    """

    def __init__(self, channel: grpc.aio.Channel) -> None:
        self._stub = ledger_pb2_grpc.AiLedgerServiceStub(channel)
        #: Held so a shutdown can await them. Without a reference, a task that
        #: nothing awaits can be garbage-collected mid-flight — the write
        #: disappears with no error anywhere, which is the same hole
        #: cancellation opens, arriving by a different route.
        self._pending: set[asyncio.Task] = set()

    def record(self, entry: GenerationEntry) -> asyncio.Task:
        """Schedules the write and returns immediately.

        `asyncio.shield` inside the task, not around the caller's await: the
        point is that cancelling the REQUEST must not cancel this, and shielding
        at the call site would only protect a caller that was already waiting.
        """
        task = asyncio.create_task(self._record(entry))

        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

        return task

    async def _record(self, entry: GenerationEntry) -> str | None:
        request = ledger_pb2.RecordGenerationRequest(
            organization_id=entry.organization_id,
            purpose=entry.purpose,
            model_name=entry.model_name,
            prompt_tokens=entry.prompt_tokens,
            completion_tokens=entry.completion_tokens,
            status=entry.status,
            retrieved_chunk_ids=entry.retrieved_chunk_ids,
            cited_chunk_ids=entry.cited_chunk_ids,
        )
        if entry.user_id:
            request.user_id = entry.user_id
        if entry.ticket_id:
            request.ticket_id = entry.ticket_id
        if entry.latency_ms is not None:
            request.latency_ms = entry.latency_ms
        if entry.content is not None:
            request.content = entry.content

        try:
            response = await asyncio.shield(
                self._stub.RecordGeneration(request, timeout=LEDGER_DEADLINE_SECONDS)
            )
            return response.generation_id
        except Exception:
            logger.exception(
                "Ledger write failed for %s (%s)",
                entry.organization_id,
                entry.purpose,
            )
            return None

    async def drain(self, timeout: float = 5.0) -> None:  # noqa: ASYNC109  # NOSONAR S7483 — see docstring
        """Waits for in-flight writes at shutdown.

        Without it, a graceful shutdown drops exactly the rows that recorded the
        last requests before it — the ones most likely to be under
        investigation when someone restarts a service.

        ASYNC109 asks for `asyncio.timeout()` at the call site instead of a
        `timeout` parameter, and that advice is WRONG here — it would invert
        what this method is for. `asyncio.timeout()` CANCELS the operation it
        wraps; `asyncio.wait(..., timeout=)` merely stops waiting and hands back
        whatever is still pending. Verified: with the current form an in-flight
        write completes after the wait returns, and under either
        `asyncio.timeout()` refactor (wrapping a `gather` or awaiting the task)
        the same write is cancelled.
        """
        if not self._pending:
            return

        await asyncio.wait(set(self._pending), timeout=timeout)
