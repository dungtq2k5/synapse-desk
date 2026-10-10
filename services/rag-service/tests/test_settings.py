"""B — the settings layer, and the half of the contract test that lives here.

The TypeScript half is `libs/common/src/configs/ai-settings.config.spec.ts`.
Between them, a default changed on one side and not the other fails that side's
own suite, in that side's own CI job — which is the point of duplicating the
assertion rather than picking one language to be authoritative.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from rag_service.settings import (
    AI_MODEL_TIERS,
    ALL_CONFIGURED_MODELS,
    CHEAP_MODEL,
    CLAMPS,
    DEFAULT_AI_MODEL_TIER,
    EMBEDDING_MODEL,
    GENERATION_MODEL_BY_TIER,
    RETRIEVAL_DEFAULTS,
    AiSettingsResolver,
    as_ai_model_tier,
    clamp_setting,
    resolve_ai_settings,
    with_co_rag_retries,
)

CONTRACT_PATH = (
    Path(__file__).resolve().parents[3]
    / "libs"
    / "common"
    / "src"
    / "configs"
    / "ai-settings.contract.json"
)

#: `snake_case` here, `camelCase` there. The rename is the only difference the
#: two languages are allowed to have, and spelling it out as data means a NEW
#: setting added on one side has no mapping here and fails immediately, rather
#: than being quietly skipped by a loop over whichever side has fewer keys.
SETTING_NAMES = {
    "semantic_weight": "semanticWeight",
    "lexical_weight": "lexicalWeight",
    "top_n": "topN",
    "final_context_k": "finalContextK",
    "escalation_threshold": "escalationThreshold",
    "co_rag_max_retries": "coRagMaxRetries",
}


@pytest.fixture
def contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text())


class TestResolution:
    def test_returns_global_defaults_with_no_tier(self):
        settings = resolve_ai_settings(DEFAULT_AI_MODEL_TIER)

        assert settings.generation_model == GENERATION_MODEL_BY_TIER["FAST"]
        assert settings.cheap_model == CHEAP_MODEL
        assert settings.embedding_model == EMBEDDING_MODEL

    def test_quality_changes_the_generation_model_and_nothing_else(self):
        # Each of the fields held constant here is a
        # plausible-sounding extension that breaks something: scaling the
        # embedding model with the tier is a full re-embed migration of every
        # tenant, and scaling the cheap model multiplies a premium tenant's
        # bill on volume calls nobody can tell apart.
        fast = resolve_ai_settings("FAST")
        quality = resolve_ai_settings("QUALITY")

        assert quality.generation_model != fast.generation_model
        assert quality.embedding_model == fast.embedding_model
        assert quality.cheap_model == fast.cheap_model

        for name in SETTING_NAMES:
            assert getattr(quality, name) == getattr(fast, name)

    def test_an_unknown_tier_degrades_to_the_default(self):
        # The tier arrives from another service's column. A typo or a value
        # from a newer deployment must fall back, never raise on a request that
        # had nothing wrong with it.
        assert as_ai_model_tier("NONSENSE") == DEFAULT_AI_MODEL_TIER
        assert as_ai_model_tier(None) == DEFAULT_AI_MODEL_TIER
        assert as_ai_model_tier("QUALITY") == "QUALITY"

    def test_every_tier_maps_to_a_model(self):
        for tier in AI_MODEL_TIERS:
            assert isinstance(GENERATION_MODEL_BY_TIER[tier], str)

    def test_the_embedding_model_matches_the_qdrant_collection(self):
        # These are two constants that MUST agree, and they are separated by a
        # module boundary — the collection pins the dimension, the settings
        # layer names the model that produces it. Disagreement fails at insert
        # time with a shape error naming neither file.
        from rag_service.qdrant.collection import EMBEDDING_MODEL as COLLECTION_MODEL

        assert EMBEDDING_MODEL == COLLECTION_MODEL


class TestClamps:
    def test_clamps_rather_than_raising(self):
        # Raising fails a tenant's request over a configuration mistake with a
        # perfectly serviceable safe answer — and the bound is that answer.
        assert clamp_setting("top_n", 5_000) == CLAMPS["top_n"][1]
        assert clamp_setting("top_n", -1) == CLAMPS["top_n"][0]
        assert clamp_setting("final_context_k", 999) == CLAMPS["final_context_k"][1]

    def test_nan_falls_back_to_the_default(self):
        # NaN compares false against everything, so min/max return it
        # untouched — it would pass through a clamp that looked correct and
        # land in a prompt size or a threshold.
        assert clamp_setting("top_n", math.nan) == RETRIEVAL_DEFAULTS["top_n"]
        assert (
            clamp_setting("escalation_threshold", math.inf)
            == CLAMPS["escalation_threshold"][1]
        )

    def test_every_shipped_default_is_already_in_range(self):
        # A default outside its own clamp is a contradiction that surfaces as a
        # value nobody configured.
        for key, value in RETRIEVAL_DEFAULTS.items():
            assert clamp_setting(key, value) == value

    def test_every_numeric_setting_is_clamped(self):
        assert sorted(CLAMPS) == sorted(RETRIEVAL_DEFAULTS)

    def test_a_per_surface_override_is_clamped_too(self):
        # The co-pilot legitimately raises retries; it must not be able to buy
        # an unbounded review loop by passing a large number.
        assert with_co_rag_retries(resolve_ai_settings("FAST"), 2).co_rag_max_retries == 2
        assert (
            with_co_rag_retries(resolve_ai_settings("FAST"), 99).co_rag_max_retries
            == CLAMPS["co_rag_max_retries"][1]
        )


class TestCache:
    async def test_a_repeat_call_is_served_from_cache(self):
        resolver = AiSettingsResolver()
        calls: list[str] = []

        async def counting_resolve(organization_id: str):
            calls.append(organization_id)
            return DEFAULT_AI_MODEL_TIER

        resolver._resolve_tier = counting_resolve  # type: ignore[method-assign]

        await resolver.settings_for("org-a")
        await resolver.settings_for("org-a")
        await resolver.settings_for("org-a")

        assert calls == ["org-a"]

    async def test_invalidation_affects_only_the_named_tenant(self):
        # A global flush on every webhook is a thundering
        # herd, and webhooks arrive in bursts.
        resolver = AiSettingsResolver()
        calls: list[str] = []

        async def counting_resolve(organization_id: str):
            calls.append(organization_id)
            return DEFAULT_AI_MODEL_TIER

        resolver._resolve_tier = counting_resolve  # type: ignore[method-assign]

        await resolver.settings_for("org-a")
        await resolver.settings_for("org-b")
        calls.clear()

        resolver.invalidate("org-a")

        await resolver.settings_for("org-b")
        assert calls == []

        await resolver.settings_for("org-a")
        assert calls == ["org-a"]

    async def test_an_expired_entry_is_re_resolved(self):
        resolver = AiSettingsResolver(ttl_seconds=-1)
        calls: list[str] = []

        async def counting_resolve(organization_id: str):
            calls.append(organization_id)
            return DEFAULT_AI_MODEL_TIER

        resolver._resolve_tier = counting_resolve  # type: ignore[method-assign]

        await resolver.settings_for("org-a")
        await resolver.settings_for("org-a")

        assert calls == ["org-a", "org-a"]

    def test_invalidating_an_uncached_tenant_is_a_no_op(self):
        # NATS core redelivers, so the same webhook arrives twice routinely.
        AiSettingsResolver().invalidate("never-seen")


class TestCrossLanguageContract:
    """The half of the drift guard that runs in Python."""

    def test_the_model_tables_match_the_contract(self, contract):
        assert CHEAP_MODEL == contract["cheapModel"]
        assert EMBEDDING_MODEL == contract["embeddingModel"]
        assert GENERATION_MODEL_BY_TIER == contract["generationModelByTier"]
        assert DEFAULT_AI_MODEL_TIER == contract["defaultTier"]

    def test_the_retrieval_defaults_match_the_contract(self, contract):
        expected = contract["retrievalDefaults"]

        assert sorted(SETTING_NAMES.values()) == sorted(expected)
        for python_name, ts_name in SETTING_NAMES.items():
            assert RETRIEVAL_DEFAULTS[python_name] == expected[ts_name]

    def test_the_clamps_match_the_contract(self, contract):
        expected = contract["clamps"]

        for python_name, ts_name in SETTING_NAMES.items():
            assert CLAMPS[python_name] == (
                expected[ts_name]["min"],
                expected[ts_name]["max"],
            )

    def test_resolved_settings_match_the_contract_for_every_tier(self, contract):
        # Stronger than comparing tables field by field: it compares the
        # resolver's OUTPUT, so a divergence in how one side assembles those
        # tables is caught even when every table matches.
        for tier in AI_MODEL_TIERS:
            settings = resolve_ai_settings(tier)

            assert settings.generation_model == contract["generationModelByTier"][tier]
            assert settings.cheap_model == contract["cheapModel"]
            assert settings.embedding_model == contract["embeddingModel"]

            for python_name, ts_name in SETTING_NAMES.items():
                assert getattr(settings, python_name) == pytest.approx(
                    contract["retrievalDefaults"][ts_name]
                )

    def test_every_configured_model_appears_in_the_contract(self, contract):
        # Catches a model added to this side's mapping and nowhere else — the
        # direction the field-by-field assertions above would miss, because a
        # new tier's model has no counterpart to be compared against.
        known = {
            contract["cheapModel"],
            contract["embeddingModel"],
            *contract["generationModelByTier"].values(),
        }

        assert set(ALL_CONFIGURED_MODELS) == known
