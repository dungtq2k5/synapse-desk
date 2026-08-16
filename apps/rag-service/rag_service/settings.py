"""`settings_for(organization_id)` — **the only place this service names a model.**

Doc 15 §1.2 states the rule and this module is the single exception: no model
name in a retrieval module, a prompt builder, a test fixture or a config read
at a call site. The failure mode is quiet — a `"gemini-3.5-flash-lite"` typed into a
generator is a tenant on the premium tier silently receiving the cheap model,
and nothing errors; the answer is merely worse, for the customer paying more.
`scripts/check-model-literals.mjs` makes that mechanical for both languages.

**This is the Python half of a two-language duplication**, mirroring
`libs/common/src/configs/ai-settings.config.ts`. That is the same class of drift
as the quota key and the purpose enums, and it is handled the same
way: both halves are asserted against `ai-settings.contract.json`, so a value
changed on one side and not the other fails that side's own test suite. The
fixture is deliberately not loaded at runtime — that would make this container's
boot depend on a path inside a TypeScript library, trading a correctness problem
for a packaging one.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, replace
from typing import Literal

AiModelTier = Literal["FAST", "QUALITY"]

AI_MODEL_TIERS: tuple[AiModelTier, ...] = ("FAST", "QUALITY")

DEFAULT_AI_MODEL_TIER: AiModelTier = "FAST"

#: **A model name lives in FIVE files and they must move together.**
#:
#: `settings.py` (here), `libs/common/src/configs/ai-settings.config.ts`,
#: `ai-settings.contract.json`, `pricing.py` and
#: `libs/common/src/configs/ai-pricing.config.ts`. The contract fixture and
#: `assert_pricing_table_covers` catch four of the five at boot or in CI; the
#: TypeScript pricing table is the one with no equivalent guard on this path,
#: so a model added everywhere except there meters as free on the Node side.
#:
#: Tier -> generation model. **This mapping is the entire tier feature**
#:: once the Stripe webhook writes `organizations.ai_model_tier`,
#: shipping tiers is this table being read with a real value instead of the
#: default, and nothing else moves.
GENERATION_MODEL_BY_TIER: dict[AiModelTier, str] = {
    "FAST": "gemini-3.5-flash-lite",
    "QUALITY": "gemini-2.5-pro",
}

#: **FAST and `CHEAP_MODEL` are the same model today, and that is deliberate.**
#:
#: They are separate CONSTANTS because they answer different questions — one is
#: a tier the tenant buys, the other is an internal volume call — and the tier
#: §2.2 is explicit that the cheap call must not scale with the tier. Pointing
#: both at one model is a pricing decision, not a merge: the moment a cheaper
#: generation model exists, only this line moves.
#:
#: The alternative was a flash model priced ABOVE the QUALITY tier's input rate,
#: which would have made a FAST tenant exhaust a money-denominated cap faster
#: than a premium one — the invariant `ai-pricing` asserts, inverted.
#:
#: Greeting classification and reformulation. Deliberately NOT tier-varying
#:: these are volume calls whose quality barely moves with model
#: tier, so scaling them multiplies a premium tenant's bill for no perceptible
#: gain.
CHEAP_MODEL = "gemini-3.5-flash-lite"

#: Never tenant-varying and never tier-varying. A Qdrant collection fixes vector
#: dimension at creation, so a per-tenant embedding model forces per-tenant
#: collections and makes every tier change a full re-embed migration
#:.
EMBEDDING_MODEL = "gemini-embedding-2"

ALL_CONFIGURED_MODELS: list[str] = [
    *GENERATION_MODEL_BY_TIER.values(),
    CHEAP_MODEL,
    EMBEDDING_MODEL,
]

#: The retrieval defaults, from `docs/rag/`. Guesses in the honest sense —
#: there is no eval set yet, which is exactly why they are kept out of
#: tenant hands. They live here so that when there IS one, tuning them is
#: editing a table rather than finding every call site that hardcoded a `k`.
RETRIEVAL_DEFAULTS: dict[str, float] = {
    "semantic_weight": 0.6,
    "lexical_weight": 0.4,
    "top_n": 20,
    "final_context_k": 5,
    "escalation_threshold": 0.3,
    "co_rag_max_retries": 0,
}

#: Server-side bounds on every numeric setting Applied whether
#: or not tenants can currently set anything: an unclamped `final_context_k` is
#: a direct path to enormous prompts and a blown budget, and the value that
#: gets there does not have to arrive from a tenant. A bad default, a migration
#: typo and a future override all take the same path.
CLAMPS: dict[str, tuple[float, float]] = {
    "semantic_weight": (0.0, 1.0),
    "lexical_weight": (0.0, 1.0),
    "top_n": (1, 100),
    "final_context_k": (1, 20),
    "escalation_threshold": (0.0, 1.0),
    "co_rag_max_retries": (0, 3),
}

#: How long a tenant's resolved settings survive without an invalidation.
CACHE_TTL_SECONDS = 5 * 60


@dataclass(frozen=True)
class AiSettings:
    """What an AI request is allowed to know about models and retrieval.

    Note what is absent: no RPC takes a model name today, and none would once
    tiers ship. That is the property keeping step 3 of doc 15's resolution
    order — per-tenant overrides — additive rather than a refactor.
    """

    generation_model: str
    """Resolved from the tier. The ONLY tier-varying value — doc 15 §2.2."""

    cheap_model: str
    lexical_weight: float
    semantic_weight: float
    top_n: int
    final_context_k: int
    escalation_threshold: float
    co_rag_max_retries: int
    embedding_model: str


def clamp_setting(key: str, value: float) -> float:
    """Forces a value into range. **Clamps rather than raising** — deliberately.

    Raising here fails a tenant's request over a configuration mistake that has
    a perfectly serviceable safe answer, and the bound IS that answer. Refusing
    to serve is the right response to a bad tenant boundary, not to a `top_n`
    of 5000.

    NaN, and only NaN, is special-cased: it compares false against everything,
    so `min`/`max` return it untouched and it would land in a prompt size or a
    threshold. Infinity needs no handling — it is ordered, so the clamp already
    resolves it to the bound.
    """
    minimum, maximum = CLAMPS[key]

    if isinstance(value, float) and math.isnan(value):
        return RETRIEVAL_DEFAULTS[key]

    return min(maximum, max(minimum, value))


def as_ai_model_tier(value: str | None) -> AiModelTier:
    """Narrows an untrusted string to a tier, falling back to the default.

    The tier arrives from another service's column. A typo, or a value written
    by a newer deployment, must degrade to the cheap tier — never to `None`,
    which would index the mapping to a `KeyError` on a request that had nothing
    wrong with it.
    """
    return value if value in AI_MODEL_TIERS else DEFAULT_AI_MODEL_TIER  # type: ignore[return-value]


def resolve_ai_settings(tier: AiModelTier) -> AiSettings:
    """Resolution steps 1 and 2 of doc 15 §1.1 — and in v1 there are only two.

    Pure and I/O-free, matching `resolveAiSettings` in TypeScript exactly. The
    caching, the tier lookup and the invalidation belong to the resolver
    wrapping this; what the two languages share is precisely this function,
    which is what makes the contract fixture a meaningful comparison rather
    than a comparison of two constant tables.
    """
    return AiSettings(
        generation_model=GENERATION_MODEL_BY_TIER[tier],
        cheap_model=CHEAP_MODEL,
        embedding_model=EMBEDDING_MODEL,
        semantic_weight=clamp_setting(
            "semantic_weight", RETRIEVAL_DEFAULTS["semantic_weight"]
        ),
        lexical_weight=clamp_setting(
            "lexical_weight", RETRIEVAL_DEFAULTS["lexical_weight"]
        ),
        top_n=int(clamp_setting("top_n", RETRIEVAL_DEFAULTS["top_n"])),
        final_context_k=int(
            clamp_setting("final_context_k", RETRIEVAL_DEFAULTS["final_context_k"])
        ),
        escalation_threshold=clamp_setting(
            "escalation_threshold", RETRIEVAL_DEFAULTS["escalation_threshold"]
        ),
        co_rag_max_retries=int(
            clamp_setting(
                "co_rag_max_retries", RETRIEVAL_DEFAULTS["co_rag_max_retries"]
            )
        ),
    )


class AiSettingsResolver:
    """`settings_for(organization_id)`, cached per tenant.

    A class rather than a module-level function with a global dict, so a test
    can hold an isolated instance — a process-wide cache makes every test that
    touches settings order-dependent on every other one.
    """

    def __init__(self, ttl_seconds: float = CACHE_TTL_SECONDS) -> None:
        self._ttl = ttl_seconds
        self._cache: dict[str, tuple[AiSettings, float]] = {}

    async def settings_for(self, organization_id: str) -> AiSettings:
        """The resolved settings for one tenant.

        Async despite resolving synchronously today, and not speculatively:
        step 2 of the resolution order reads `ai_model_tier` over gRPC and step
        3 reads `organization_ai_settings` from Postgres. The signature would
        have to change the moment either lands — across every AI call site,
        which is the exact set this layer exists to never have to revisit.
        """
        cached = self._cache.get(organization_id)
        if cached is not None and cached[1] > time.monotonic():
            return cached[0]

        settings = resolve_ai_settings(await self._resolve_tier(organization_id))
        self._cache[organization_id] = (settings, time.monotonic() + self._ttl)

        return settings

    def invalidate(self, organization_id: str) -> None:
        """Drops ONE tenant's cached settings.

        One tenant, never all of them (doc 15 §1.4 test 4). Stripe webhooks
        arrive in bursts — a plan change, an invoice and a subscription update
        within seconds — and a global flush on each would re-resolve every
        active tenant at once, at exactly the moment the system can least
        absorb it.

        Invalidation reaches this service the same way it reaches
        `ingestion-service`: `billing.entitlements_changed` over NATS. Without
        it, a downgraded tenant keeps receiving the premium model for a whole
        TTL — the system giving away the thing it just stopped being paid for,
        which nobody reports because it fails in the direction that costs money
        rather than the direction a customer notices.
        """
        self._cache.pop(organization_id, None)

    # `async` with nothing awaited, deliberately.
    #
    # The lookup this stands in for is an RPC (`GetOrganizationEntitlements`),
    # so the keyword describes what the method IS rather than what today's
    # one-line body does. Dropping it now would move `settings_for`'s call site
    # as well, and move it back when the RPC lands — the exact churn the
    # docstring below claims this shape avoids.
    async def _resolve_tier(self, organization_id: str) -> AiModelTier:  # NOSONAR
        """Where the tier will come from — and today it comes from nowhere.

        `organizations.ai_model_tier` does not exist yet: the Stripe webhook
        writes it and this reads it over
        `GetOrganizationEntitlements`. Until then every tenant
        resolves to the default.

        **The constant is returned from HERE rather than from `settings_for`**,
        which is the difference between this being finished work and a stub.
        Every call site already goes through the mapping, so shipping the tier
        is replacing this method body — no caller moves, which is the claim
        doc 15 §1.1 makes about the whole layer.
        """
        _ = organization_id
        return DEFAULT_AI_MODEL_TIER


def with_co_rag_retries(settings: AiSettings, retries: int) -> AiSettings:
    """The one per-SURFACE override, clamped like everything else.

    Tier 1 chat runs `co_rag_max_retries = 0` because it streams and cannot
    afford a review pass; the co-pilot runs 1-2 because an agent absorbs the
    latency. That is a property of the call site rather than of
    the tenant, so it is applied here — still through the clamp, so a surface
    cannot buy itself an unbounded retry loop by passing a large number.
    """
    # This DOES return `AiSettings`. typeshed types the stdlib helper as
    # `replace(obj: _DataclassT, /, **changes: Any) -> _DataclassT` — a TypeVar
    # that resolves to whatever went in — so an analyzer reporting
    # `DataclassInstance` is showing the TypeVar's BOUND rather than its
    # solution. Checked rather than assumed: ruff and pyrefly both accept the
    # annotation, and the returned value is an `AiSettings` at runtime.
    return replace(  # NOSONAR
        settings,
        co_rag_max_retries=int(clamp_setting("co_rag_max_retries", retries)),
    )
