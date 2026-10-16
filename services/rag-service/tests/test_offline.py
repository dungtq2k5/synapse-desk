"""The model-free provider and the switch that selects it."""

from __future__ import annotations

import dataclasses
import math

import pytest

from rag_service.config import load_config
from rag_service.generation.corag import build_prompt
from rag_service.offline import (
    OFFLINE_ANSWER,
    OfflineEmbeddingClient,
    OfflineGenerator,
    offline_vector,
)
from rag_service.qdrant.collection import EMBEDDING_DIMENSION
from rag_service.retrieval.service import HydratedChunk
from rag_service.server import select_providers


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


def _chunk(index: int, title: str, text: str) -> HydratedChunk:
    return HydratedChunk(
        chunk_id=f"c{index}",
        document_id=f"d{index}",
        document_title=title,
        page_number=index,
        chunk_index=index,
        content_text=text,
        score=1.0,
        vector_point_id=f"v{index}",
    )


class TestOfflineEmbeddings:
    async def test_the_same_text_gets_the_same_vector_of_the_collection_s_size(self):
        client = OfflineEmbeddingClient()
        first = await client.embed_query("annual leave carryover", "any")
        second = await client.embed_query("annual leave carryover", "any")

        assert first.vector == second.vector
        assert len(first.vector) == EMBEDDING_DIMENSION
        assert math.isclose(math.sqrt(sum(v * v for v in first.vector)), 1.0)
        assert first.prompt_tokens > 0

    def test_shared_words_rank_closer_than_none(self):
        query = offline_vector("When does the annual leave reset?")
        near = offline_vector("Annual leave resets on 1 January.")
        far = offline_vector("The printer on floor three is jammed.")

        assert _cosine(query, near) > _cosine(query, far)

    def test_a_text_without_words_is_still_a_usable_vector(self):
        vector = offline_vector("…")

        assert any(value != 0 for value in vector)


class TestOfflineGeneration:
    async def test_answers_with_fixed_text_citing_every_source(self):
        prompt = build_prompt(
            "When does the allowance reset?",
            [
                _chunk(1, "Remote Work Policy", "Resets on 1 January."),
                _chunk(2, "Expenses FAQ", "Claims within 30 days."),
            ],
        )

        parts = [
            delta.text
            async for delta in OfflineGenerator().stream(prompt, "any", 1024)
            if delta.text
        ]

        assert "".join(parts) == f"{OFFLINE_ANSWER} [1] [2]."

    async def test_a_prompt_without_sources_gets_an_empty_object(self):
        parts = [
            delta.text
            async for delta in OfflineGenerator().stream("Summarize.", "any", 512)
            if delta.text
        ]

        assert parts == ["{}"]

    async def test_one_shot_calls_answer_empty_for_the_caller_s_default(self):
        output = await OfflineGenerator().generate("Classify: hello", "any", 8)

        assert output.text == ""


class TestSelectProviders:
    @pytest.fixture
    def config(self, monkeypatch):
        for name, value in {
            "QDRANT_URL": "http://localhost:6333",
            "INGESTION_DATABASE_URL": "postgresql://x",
            "REDIS_URL": "redis://localhost:6379",
            "INGESTION_SERVICE_URL": "localhost:5004",
        }.items():
            monkeypatch.setenv(name, value)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.delenv("RAG_OFFLINE_MODEL", raising=False)
        monkeypatch.delenv("APP_ENV", raising=False)
        return load_config()

    def test_offline_needs_no_key(self, config):
        embeddings, generator = select_providers(
            dataclasses.replace(config, offline_model=True)
        )

        assert isinstance(embeddings, OfflineEmbeddingClient)
        assert isinstance(generator, OfflineGenerator)

    def test_offline_is_refused_under_production(self, config):
        with pytest.raises(RuntimeError, match="APP_ENV=production"):
            select_providers(
                dataclasses.replace(config, offline_model=True, app_env="production")
            )

    def test_the_real_provider_still_needs_its_key(self, config):
        with pytest.raises(RuntimeError, match="GEMINI_API_KEY is empty"):
            select_providers(config)

    def test_the_switch_reads_the_environment(self, monkeypatch, config):
        monkeypatch.setenv("RAG_OFFLINE_MODEL", "true")
        monkeypatch.setenv("APP_ENV", "production")
        loaded = load_config()

        assert loaded.offline_model is True
        assert loaded.app_env == "production"
