"""The tier, and the four things it must NOT change.

Every test here is a commercial claim rather than a technical one. The tier is
the product's only sellable AI knob, and each row of the tier table is a
plausible-sounding extension that would break something:

  - scaling the EMBEDDING model with the tier is a full re-embed migration of
    every tenant;
  - scaling the CHEAP model multiplies a premium tenant's bill on volume calls
    nobody can tell apart;
  - and the one that makes the whole thing safe to sell is that a QUALITY
    tenant's spend rises with their MONEY, not their token count — which is only
    true because RDM §1.14 meters `estimated_cost_micros`.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from rag_service.enums import AiGenerationPurpose
from rag_service.generation.corag import CoRagGenerator, GenerationDelta
from rag_service.generation.parts import Prompt, prompt_text
from rag_service.preprocess.pipeline import PreprocessPipeline, Turn
from rag_service.pricing import estimate_cost_micros
from rag_service.retrieval.service import BudgetState, HydratedChunk
from rag_service.settings import (
    AiModelTier,
    AiSettingsResolver,
    resolve_ai_settings,
)

CYCLE = datetime(2026, 8, 1, tzinfo=timezone.utc)

#: The same question, asked identically by both tenants. Everything that differs
#: downstream differs because of the TIER and nothing else.
QUESTION = "what is the carryover limit?"


def chunk(index: int = 1) -> HydratedChunk:
    return HydratedChunk(
        chunk_id=f"chunk-{index}",
        document_id="doc-1",
        document_title="Handbook",
        page_number=4,
        chunk_index=index,
        content_text="Unused leave carries over once, up to five days.",
        score=1.0,
        vector_point_id=f"point-{index}",
    )


class FixedGenerator:
    """Emits the SAME token counts whatever model it is handed.

    That is the point: identical usage on both tiers isolates the variable under
    test to the price. A generator whose output varied with the model would make
    a cost difference unattributable — it could be the tier or it could be the
    answer being longer.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def stream(self, prompt: Prompt, model: str, max_output_tokens: int):
        self.calls.append((prompt_text(prompt), model))

        yield GenerationDelta(text="It carries over once [1].")
        yield GenerationDelta(done=True, prompt_tokens=1_000, completion_tokens=200)

    async def generate(self, prompt: Prompt, model: str, max_output_tokens: int):
        from rag_service.preprocess.pipeline import GenerationOutput

        self.calls.append((prompt_text(prompt), model))

        return GenerationOutput(text="FACTUAL", prompt_tokens=50, completion_tokens=1)


class RecordingQuota:
    def __init__(self) -> None:
        self.charges: list[int] = []

    async def charge(self, _org, _cycle, cost_micros):
        self.charges.append(cost_micros)


@pytest.fixture
def quota() -> RecordingQuota:
    return RecordingQuota()


@pytest.fixture
def budget():
    return BudgetState(organization_id="org", cycle_start=CYCLE, allows_embedding=True)


async def answer_on(tier: AiModelTier, generator, ledger, quota, budget):
    """One answer, generated on `tier`, through the real Co-RAG path.

    `AiModelTier` rather than `str`: `resolve_ai_settings` takes the literal
    union, so a bare `str` made every call site here unchecked — and a typo'd
    tier would have resolved to the default instead of failing.
    """
    settings = resolve_ai_settings(tier)
    corag = CoRagGenerator(generator, ledger, quota)

    return await corag.generate(
        QUESTION,
        [chunk()],
        settings,
        budget=budget,
        purpose=AiGenerationPurpose.CHAT_ANSWER,
        retrieved_chunk_ids=["chunk-1"],
    )


class TestWhatTheTierChanges:
    async def test_1_a_QUALITY_generation_ledgers_the_premium_model_and_more_money(
        self, ledger, quota, budget
    ):
        # **Cost metering doing its job** — the number that would be wrong under
        # token budgeting. Identical token counts, different money, because the
        # ledger records `estimated_cost_micros` rather than raw tokens.
        generator = FixedGenerator()

        await answer_on("FAST", generator, ledger, quota, budget)
        fast_entry, fast_charge = ledger.entries[-1], quota.charges[-1]

        await answer_on("QUALITY", generator, ledger, quota, budget)
        quality_entry, quality_charge = ledger.entries[-1], quota.charges[-1]

        assert fast_entry.model_name != quality_entry.model_name
        # The SAME tokens on both sides — so the difference below is price.
        assert fast_entry.prompt_tokens == quality_entry.prompt_tokens
        assert fast_entry.completion_tokens == quality_entry.completion_tokens

        assert quality_charge > fast_charge
        assert quality_charge == estimate_cost_micros(
            quality_entry.model_name,
            quality_entry.prompt_tokens,
            quality_entry.completion_tokens,
        )


class TestWhatTheTierMustNotChange:
    """Each row a plausible extension that breaks something."""

    async def test_2_a_QUALITY_tenant_still_classifies_on_the_CHEAP_model(
        self, ledger, budget
    ):
        # Volume calls whose quality barely moves with model tier. Scaling them
        # multiplies a premium tenant's bill for no perceptible gain — and
        # greeting classification is the highest-volume call in the system.
        generator = FixedGenerator()
        settings = resolve_ai_settings("QUALITY")
        pipeline = PreprocessPipeline(generator, ledger, RecordingQuota())

        await pipeline.run(QUESTION, [], settings, budget=budget)

        assert [model for _, model in generator.calls] == [settings.cheap_model]
        assert settings.cheap_model != settings.generation_model

    async def test_2b_reformulation_also_stays_on_the_cheap_model(
        self, ledger, budget
    ):
        generator = FixedGenerator()
        settings = resolve_ai_settings("QUALITY")
        pipeline = PreprocessPipeline(generator, ledger, RecordingQuota())

        await pipeline.run(
            "tell me more about it",
            [Turn(role="user", content="what is the carryover limit?")],
            settings,
            budget=budget,
        )

        assert {model for _, model in generator.calls} == {settings.cheap_model}

    def test_3_both_tiers_embed_with_the_SAME_model(self):
        # A Qdrant collection fixes vector dimension at creation. Per-tenant
        # embedding models force per-tenant collections and make every tier
        # change a full re-embed migration of every tenant — the most expensive
        # possible consequence of a one-column change.
        assert (
            resolve_ai_settings("FAST").embedding_model
            == resolve_ai_settings("QUALITY").embedding_model
        )

    def test_3b_the_tier_changes_the_generation_model_and_NOTHING_else(self):
        fast = resolve_ai_settings("FAST")
        quality = resolve_ai_settings("QUALITY")

        assert fast.generation_model != quality.generation_model

        for field in (
            "cheap_model",
            "embedding_model",
            "semantic_weight",
            "lexical_weight",
            "top_n",
            "final_context_k",
            "escalation_threshold",
            "co_rag_max_retries",
        ):
            assert getattr(fast, field) == getattr(quality, field)

    def test_3c_retrieval_isolation_is_not_a_tier_benefit(self):
        # "A paid tier buys a better model. It does not buy a weaker boundary."
        # `tenant_scope()` takes a CallerContext and nothing else — there is no
        # parameter through which a tier could widen it, which is the strongest
        # form this guarantee can take.
        import inspect

        from rag_service.retrieval.tenant_scope import tenant_scope

        parameters = list(inspect.signature(tenant_scope).parameters)
        assert parameters == ["ctx"]


class TestTheCommercialConsequence:
    async def test_4_a_QUALITY_tenant_hits_the_cap_SOONER_for_the_same_questions(
        self, ledger, budget
    ):
        # **The consequence a token-denominated budget would have hidden
        # entirely.** Same question count, same tokens, and the premium tenant
        # exhausts the allowance first — which is what makes the cap keep
        # meaning what it meant once model choice became sellable.
        budget_micros = 4_000
        results: dict[str, int] = {}

        for tier in ("FAST", "QUALITY"):
            quota = RecordingQuota()
            generator = FixedGenerator()
            spent = 0
            asked = 0

            while spent < budget_micros and asked < 100:
                await answer_on(tier, generator, ledger, quota, budget)
                spent += quota.charges[-1]
                asked += 1

            results[tier] = asked

        assert results["QUALITY"] < results["FAST"]


class TestDowngrade:
    async def test_5_the_NEXT_request_uses_the_FAST_model_after_a_downgrade(self):
        # Invalidation, end to end on the Python side. Without it a
        # downgraded tenant keeps the premium model for the whole cache TTL —
        # the system giving away the exact thing it just stopped being paid for,
        # in the direction that costs money rather than the one someone
        # complains about.
        resolver = AiSettingsResolver()
        tier = {"value": "QUALITY"}

        async def resolve_tier(_organization_id: str):
            return tier["value"]

        resolver._resolve_tier = resolve_tier  # type: ignore[method-assign]

        before = await resolver.settings_for("org-a")
        assert before.generation_model == resolve_ai_settings("QUALITY").generation_model

        # The webhook writes the column and emits `billing.entitlements_changed`.
        tier["value"] = "FAST"

        # WITHOUT the invalidation the cache still serves the premium model —
        # asserted, because that is the failure the event exists to prevent.
        assert (
            await resolver.settings_for("org-a")
        ).generation_model == before.generation_model

        resolver.invalidate("org-a")

        after = await resolver.settings_for("org-a")
        assert after.generation_model == resolve_ai_settings("FAST").generation_model

    async def test_5b_an_invalidation_touches_only_the_named_tenant(self):
        # A global flush on every webhook is a thundering herd, and webhooks
        # arrive in bursts — a plan change, an invoice and a subscription update
        # within seconds of each other.
        resolver = AiSettingsResolver()
        calls: list[str] = []

        async def resolve_tier(organization_id: str):
            calls.append(organization_id)
            return "FAST"

        resolver._resolve_tier = resolve_tier  # type: ignore[method-assign]

        await resolver.settings_for("org-a")
        await resolver.settings_for("org-b")
        calls.clear()

        resolver.invalidate("org-a")

        await resolver.settings_for("org-b")
        assert calls == []
