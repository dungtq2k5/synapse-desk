"""The quota counter, incremented DIRECTLY rather than over gRPC.

RDM §1.14 and 12-doc §1.3: routing the charge through `ingestion-service` would
put a network round trip on the hot path of every AI request in order to avoid
duplicating one string format. The format is duplicated instead — here — and
guarded by a contract test that builds the same key on both sides.

**The charge is awaited; the ledger row is not.** That split is the whole
design. `INCRBY` is sub-millisecond and synchronous because it is the only thing
standing between a burst of concurrent requests and all of them reading the same
stale value and all passing the gate. The durable row can lag; the counter
cannot.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

import redis.asyncio as redis

logger = logging.getLogger(__name__)

#: Long enough to outlive any billing cycle, short enough that abandoned keys
#: do not accumulate forever. The cycle is in the KEY, so expiry is cleanup
#: rather than correctness — a new cycle reads a new key regardless.
COUNTER_TTL_SECONDS = 70 * 24 * 60 * 60


def quota_counter_key(organization_id: str, billing_cycle_start: datetime) -> str:
    """THE key. The Python twin of `quotaCounterKey` in `@synapsedesk/common`.

    **Seconds, not milliseconds.** `datetime.timestamp()` yields seconds and
    JavaScript's `getTime()` yields milliseconds, and that mismatch is the
    single most likely way the two implementations silently disagree — the two
    services would then meter the same tenant into two different keys, and each
    would report the tenant comfortably under budget.
    """
    epoch_seconds = int(billing_cycle_start.timestamp())

    return f"quota:{organization_id}:{epoch_seconds}"


@dataclass(frozen=True)
class BudgetDecision:
    allowed: bool
    spent_micros: int
    limit_micros: int


class QuotaCounter:
    """Reads and increments one tenant's spend for the current cycle."""

    def __init__(self, client: redis.Redis) -> None:
        self._client = client

    async def spent(self, organization_id: str, cycle_start: datetime) -> int | None:
        """Current spend, or **None when Redis is unreachable**.

        None rather than 0, and the distinction is the point: a caller that
        cannot tell "no spend yet" from "cannot tell" will treat an outage as an
        empty counter and let every request through. The gate FAILS CLOSED on
        None — the one place a cache miss must not mean
        "allow".
        """
        key = quota_counter_key(organization_id, cycle_start)

        try:
            raw = await self._client.get(key)
        except Exception:
            # `.exception`, so the traceback travels with it. These are
            # infrastructure failures — Redis unreachable, a timeout — where the
            # message alone ("ECONNREFUSED") says what broke but never where.
            logger.exception("Quota counter unreadable for %s", organization_id)
            return None

        return int(raw) if raw else 0

    async def charge(
        self, organization_id: str, cycle_start: datetime, cost_micros: int
    ) -> None:
        """One awaited INCRBY. **Fails OPEN**, unlike the gate.

        The asymmetry is deliberate and it is not an inconsistency. The gate
        fails closed because letting a request through when the budget is
        unknown spends money that may not exist. The charge fails open because
        the money is ALREADY SPENT by the time this runs — the model has
        answered — so refusing here would lose the work as well as the money,
        and the hourly reconciliation re-derives the true figure from the
        ledger anyway.
        """
        if cost_micros <= 0:
            return

        key = quota_counter_key(organization_id, cycle_start)

        try:
            async with self._client.pipeline(transaction=True) as pipe:
                pipe.incrby(key, cost_micros)
                # Refreshed on every charge rather than set once at creation:
                # `SET NX` + `EXPIRE` has a window where a crash between the two
                # leaves a key with no expiry at all, and that key then lives
                # forever in a system that creates one per tenant per month.
                pipe.expire(key, COUNTER_TTL_SECONDS)
                await pipe.execute()
        except Exception:
            logger.exception(
                "Could not charge %d micros to %s", cost_micros, organization_id
            )
