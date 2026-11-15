"""Tokens -> money. The Python twin of `ai-pricing.config.ts`.

Duplicated across the language boundary for the same reason the quota key is:
this service charges the counter directly rather than over gRPC (RDM §1.14), so
it has to be able to compute what to charge. A round trip to ask "what does this
cost" would defeat the point of not making a round trip to charge it.

**This file and `settings.py` are the only two places in this service where a
model name may appear**, and for different reasons — this one is keyed BY model
rather than choosing one. `scripts/check-model-literals.mjs` allowlists both.

Held honest by `ai-settings.contract.json` (`modelPricing`) like every other
cross-language constant: prices that drift between the two services would meter the same call
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
#: Published paid-tier rates, read off ai.google.dev/gemini-api/docs/pricing.
#: Micros per million equals USD per million exactly — $1.25/M is 1_250_000.
MODEL_PRICING: dict[str, ModelPricing] = {
    #: Priced at the rate from 2026-12-01 ($4 / $20), not the launch rate
    #: ($2 / $10), so it never under-counts. Output includes thinking tokens.
    "gemini-4-argon": ModelPricing(4_000_000, 20_000_000),
    #: Text input only. The other modalities this model prices (image, audio,
    #: video) are unreachable here — this service embeds question and chunk
    #: TEXT and nothing else.
    "gemini-embedding-2": ModelPricing(200_000, 0),
    "gemini-3.5-flash-lite": ModelPricing(300_000, 2_500_000),
    #: Local models, priced by the electricity they burn:
    #:
    #:   micros per 1M tokens = watts / 1000 x (1,000,000 / tokens per second)
    #:                          / 3600 x LOCAL_ENERGY_PRICE_MICROS_PER_KWH
    #:
    #: Measured 2026-11-12 with Ollama 0.40.13 at num_ctx 8192; tokens per
    #: second from Ollama's own `prompt_eval_*` / `eval_*`. Each row is the
    #: HIGHEST of its runs, so a model never prices below what it can cost:
    #:
    #:   GPU (RX 6600, Vulkan), watts measured from `power1_average`:
    #:     7B     prompt 579.7 tok/s at 96.8 W   completion 43.9 tok/s at 98.2 W
    #:     3B     prompt 840.6 tok/s at 73.7 W   completion 86.8 tok/s at 94.8 W
    #:     nomic         6,897 tok/s at 52.4 W
    #:   CPU (i5-12400F), at its RATED 65 W base power, not a measurement
    #:   (package power isn't readable without root):
    #:     7B     prompt  60.4 tok/s             completion  7.5 tok/s
    #:     3B     prompt 129.0 tok/s             completion 16.9 tok/s
    #:     nomic         1,549.7 tok/s
    #:
    #: So every row is the CPU's, which also keeps the 7B (QUALITY) above the
    #: 3B (FAST).
    "qwen2.5:7b-instruct-q4_K_M": ModelPricing(47_962, 385_581),
    "qwen2.5:3b-instruct-q4_K_M": ModelPricing(22_472, 171_200),
    "nomic-embed-text:v1.5": ModelPricing(1_870, 0),
}

#: The household tariff a local model's power is billed at, in VND per kWh:
#: EVN's top tier from 2026-11-01 (3,844, Quyết định 2892/QĐ-BCT) plus 8% VAT,
#: rounded up. The top tier because a model's draw lands on top of the
#: household's other use.
LOCAL_ENERGY_PRICE_VND_PER_KWH = 4_152

#: Vietcombank's USD selling rate, 2026-11-12 21:40, which the local prices
#: above were derived at.
VND_PER_USD = 25_870

#: 4,152 / 25,870 USD, in micros, rounded up.
LOCAL_ENERGY_PRICE_MICROS_PER_KWH = math.ceil(
    LOCAL_ENERGY_PRICE_VND_PER_KWH / VND_PER_USD * 1_000_000
)


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
