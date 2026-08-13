"""One metered call: generate, CHARGE, then RECORD — RDM §1.14.

Extracted when Layer B's standalone classification (33-doc §3.3) became the
second caller needing exactly this sequence. **The ordering is the design, and
that is why it is shared rather than copied**: the charge is awaited because it
is the only thing standing between a burst of concurrent requests and all of
them passing a stale gate, and the row is fire-and-forget because the money is
already spent by the time it runs. A second hand-written copy of that sequence
is a second place for it to be got subtly wrong, on the path where wrong means
either unmetered spend or a gate that does not hold.

`CopilotService` keeps its own — its version returns the record task and can
skip the charge for a cancelled stream, and folding those branches in here would
make the shared thing more complicated than the duplication it removed.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Protocol

from rag_service.ledger.client import GenerationEntry
from rag_service.retrieval.service import BudgetState

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GenerationOutput:
    text: str
    prompt_tokens: int
    completion_tokens: int


class TextGenerator(Protocol):
    """The minimal generation capability a metered call needs."""

    async def generate(
        self, prompt: str, model: str, max_output_tokens: int
    ) -> GenerationOutput: ...


class LedgerRecorder(Protocol):
    """Where a metered call books its row.

    A protocol rather than the concrete `LedgerClient`, matching `TextGenerator`
    one line up. The eval harness deliberately substitutes a null recorder — it
    measures answer quality, and thirty rows written to a tenant deleted a
    minute later would be noise the flag jobs reason about — and the concrete
    annotation was the only thing making that legal substitution look wrong.

    **Positional-only, and that is load-bearing rather than style.** Without the
    `/`, a structural check also matches the parameter NAME, because a caller
    could legally write `record(entry=…)`. The eval's stub names it `_entry` —
    the file's own convention for a parameter it does not read — so the two
    fixes defeated each other: the protocol was added to make the substitution
    legal and the rename made it illegal again, in a different file, with the
    error surfacing at neither. A protocol that only ever gets called
    positionally should say so.
    """

    #: Returns the scheduled write. `MeteredGenerator` discards it — the money
    #: is already spent by the time the row lands — but `CopilotService` shields
    #: and awaits it for the generation id, so the protocol has to promise
    #: something awaitable rather than `object`.
    def record(self, entry: GenerationEntry, /) -> Awaitable[str]: ...


class QuotaCharger(Protocol):
    """Where a metered call charges the tenant.

    **This one was previously unannotated entirely**, which is the more
    interesting half: nothing verified that whatever was passed could charge —
    on the call that stands between a burst of concurrent requests and all of
    them passing a stale gate. That the eval's stub happened to match was luck,
    not a check.
    """

    #: Positional-only for the same reason `record` is: the implementations
    #: name these differently (`_org`, `_cycle`, `*_args`) because most of them
    #: do not read every argument, and a structural check that also matched
    #: names would reject a stub that is behaviourally identical.
    async def charge(
        self, organization_id: str, cycle_start, cost_micros: int, /
    ) -> object: ...


class MeteredGenerator:
    """A generator that charges the tenant and books the row.

    Returns `None` rather than raising when the provider fails. Every caller
    here has a degraded answer that is better than an error — a classification
    falls back to its safe label, a reformulation falls back to the original
    question — and a raise would turn a provider wobble into a failed request.
    """

    def __init__(
        self,
        generator: TextGenerator,
        ledger: LedgerRecorder,
        quota: QuotaCharger,
    ) -> None:
        self._generator = generator
        self._ledger = ledger
        self._quota = quota

    async def generate(
        self,
        prompt: str,
        model: str,
        max_output_tokens: int,
        *,
        purpose: str,
        budget: BudgetState,
        user_id: str | None,
    ) -> GenerationOutput | None:
        started_at = time.monotonic()

        try:
            output = await self._generator.generate(prompt, model, max_output_tokens)
        except Exception as error:
            logger.warning("%s failed: %s", purpose, error)

            return None

        latency_ms = int((time.monotonic() - started_at) * 1000)

        from rag_service.pricing import estimate_cost_micros

        await self._quota.charge(
            budget.organization_id,
            budget.cycle_start,
            estimate_cost_micros(model, output.prompt_tokens, output.completion_tokens),
        )

        self._ledger.record(
            GenerationEntry(
                organization_id=budget.organization_id,
                user_id=user_id,
                purpose=purpose,
                model_name=model,
                prompt_tokens=output.prompt_tokens,
                completion_tokens=output.completion_tokens,
                latency_ms=latency_ms,
            )
        )

        return output
