"""Tokens -> money. The Python twin of `ai-pricing.config.ts`.

Duplicated across the language boundary for the same reason the quota key is:
this service charges the counter directly rather than over gRPC (RDM §1.14), so
it has to be able to compute what to charge. A round trip to ask "what does this
cost" would defeat the point of not making a round trip to charge it.

**This file and `settings.py` are the only two places in this service where a
model name may appear**, and for different reasons — this one is keyed BY model
rather than choosing one. `scripts/check-model-literals.mjs` allowlists both.

Held honest by `ai-settings.contract.json` like every other cross-language
constant: prices that drift between the two services would meter the same call
at two different amounts, and the reconciliation job would "correct" the counter
to whichever service wrote last.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelPricing:
    #: Micros per 1,000,000 input tokens.
    prompt_micros_per_million: int
    #: Micros per 1,000,000 output tokens. Zero for an embedding model.
    completion_micros_per_million: int


#: Micros — millionths of a currency unit — rather than floats. Money in
#: floating point accumulates error over millions of rows, and a metering ledger
#: is exactly where that compounds.
MODEL_PRICING: dict[str, ModelPricing] = {
    "gemini-2.0-flash": ModelPricing(100_000, 400_000),
    "gemini-2.5-pro": ModelPricing(1_250_000, 10_000_000),
    "text-embedding-004": ModelPricing(25_000, 0),
    "gemini-2.0-flash-lite": ModelPricing(37_500, 150_000),
}


def pricing_for(model_name: str) -> ModelPricing:
    """The entry, or a raised error naming the model. **Never a silent zero.**

    An unpriced model meters as free, which is precisely the hole this table
    exists to close — and it would close it invisibly, reporting a tenant well
    under budget while they spent freely.
    """
    pricing = MODEL_PRICING.get(model_name)
    if pricing is None:
        raise KeyError(
            f"No pricing for model '{model_name}'. Add it to MODEL_PRICING — "
            "an unpriced model meters as free."
        )

    return pricing


def estimate_cost_micros(
    model_name: str, prompt_tokens: int, completion_tokens: int
) -> int:
    """Rounded UP, in the same direction as the TypeScript implementation.

    A fractional micro rounded down on every call under-counts systematically,
    and the direction matters: an under-count lets a tenant spend past their
    cap, while an over-count of at most one micro per call costs nobody
    anything measurable.
    """
    pricing = pricing_for(model_name)

    prompt = math.ceil(prompt_tokens * pricing.prompt_micros_per_million / 1_000_000)
    completion = math.ceil(
        completion_tokens * pricing.completion_micros_per_million / 1_000_000
    )

    return prompt + completion


def assert_pricing_table_covers(model_names: list[str]) -> None:
    """Fails at BOOT if any configured model is unpriced.

    At boot rather than at first use: a model discovered unpriced at first use
    has already been metered as free at least once, and the ledger has no way
    to go back and re-price it.
    """
    missing = [name for name in model_names if name not in MODEL_PRICING]

    if missing:
        raise RuntimeError(
            f"Unpriced model(s) configured: {', '.join(missing)}. "
            "Add them to MODEL_PRICING before boot — an unpriced model meters as free."
        )
