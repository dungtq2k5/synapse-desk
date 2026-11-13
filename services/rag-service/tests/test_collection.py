"""Booting against a collection another service is creating at the same moment,
and finding a model's alias, adopting the pre-alias collection, or holding."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from qdrant_client.http import models as qm
from qdrant_client.http.exceptions import UnexpectedResponse

from rag_service.qdrant.collection import (
    EMBEDDING_DIMENSION,
    EMBEDDING_MODEL,
    LEGACY_COLLECTION,
    KnowledgeBase,
    KnowledgeBaseRebuilding,
    collection_alias,
    ensure_collection,
)
from rag_service.settings import MODELS_BY_PROVIDER

LOCAL_MODEL = MODELS_BY_PROVIDER["ollama"]["embedding_model"]


def _refusal(status: int, reason: str) -> UnexpectedResponse:
    return UnexpectedResponse(
        status_code=status,
        reason_phrase=reason,
        content=b'{"status":{"error":"Wrong input: Collection `document_chunks` already exists!"}}',
        headers={},  # type: ignore[arg-type]
    )


class _Client:
    """Qdrant with no collection yet, whose create answers `create_error`."""

    def __init__(
        self,
        create_error: Exception | None,
        size: int = EMBEDDING_DIMENSION,
        model: str | None = None,
        existing: tuple[str, ...] = (),
        aliases: dict[str, str] | None = None,
    ):
        self.create_error = create_error
        self.size = size
        self.model = model
        self.existing = set(existing)
        self.aliases = dict(aliases or {})
        self.indexed: list[str] = []
        self.read_back = False
        self.metadata_set: dict[str, object] = {}

    async def collection_exists(self, name: str) -> bool:
        return name in self.existing

    async def create_collection(self, **kwargs: object) -> bool:
        if self.create_error is not None:
            raise self.create_error
        self.existing.add(str(kwargs["collection_name"]))
        return True

    async def get_aliases(self) -> SimpleNamespace:
        return SimpleNamespace(
            aliases=[
                SimpleNamespace(alias_name=alias, collection_name=collection)
                for alias, collection in self.aliases.items()
            ]
        )

    async def update_collection_aliases(self, *, change_aliases_operations) -> bool:
        for operation in change_aliases_operations:
            created = operation.create_alias
            self.aliases[created.alias_name] = created.collection_name
        return True

    async def update_collection(self, *, collection_name: str, metadata) -> bool:
        self.metadata_set[collection_name] = metadata
        return True

    async def get_collection(self, _name: str) -> SimpleNamespace:
        self.read_back = True
        vectors = qm.VectorParams(size=self.size, distance=qm.Distance.COSINE)
        metadata = {"embedding_model": self.model} if self.model else None
        return SimpleNamespace(
            config=SimpleNamespace(
                params=SimpleNamespace(vectors=vectors), metadata=metadata
            )
        )

    async def create_payload_index(self, *, field_name: str, **_kwargs: object) -> bool:
        self.indexed.append(field_name)
        return True


async def test_creates_a_missing_collection_and_its_indexes():
    client = _Client(create_error=None)

    await ensure_collection(client)  # type: ignore[arg-type]

    assert not client.read_back
    assert len(client.indexed) == 6


async def test_a_create_that_loses_the_race_goes_on_as_if_it_found_the_collection():
    client = _Client(create_error=_refusal(409, "Conflict"))

    await ensure_collection(client)  # type: ignore[arg-type]

    assert client.read_back
    assert len(client.indexed) == 6


async def test_the_other_services_collection_still_has_its_dimension_checked():
    client = _Client(
        create_error=_refusal(409, "Conflict"), size=EMBEDDING_DIMENSION + 1
    )

    with pytest.raises(RuntimeError, match="dimensional vectors"):
        await ensure_collection(client)  # type: ignore[arg-type]


async def test_any_other_create_failure_fails_the_boot():
    client = _Client(create_error=_refusal(400, "Bad Request"))

    with pytest.raises(UnexpectedResponse):
        await ensure_collection(client)  # type: ignore[arg-type]
    assert client.indexed == []


class _Loading(_Client):
    """A collection the other service just created: it exists, still loading."""

    def __init__(self, failures: int):
        super().__init__(create_error=None)
        self.failures = failures

    async def collection_exists(self, name: str) -> bool:
        return True

    async def create_collection(self, **_kwargs: object) -> bool:
        raise _refusal(409, "Conflict")

    async def get_collection(self, _name: str) -> SimpleNamespace:
        if self.failures > 0:
            self.failures -= 1
            raise _refusal(500, "Internal Server Error")
        return await super().get_collection(_name)


async def test_a_collection_still_loading_is_waited_for(monkeypatch):
    monkeypatch.setattr("rag_service.qdrant.collection.READ_DELAY_SECONDS", 0)
    client = _Loading(failures=3)

    await ensure_collection(client)  # type: ignore[arg-type]

    assert client.read_back
    assert len(client.indexed) == 6


async def test_a_collection_that_never_loads_still_fails_the_boot(monkeypatch):
    monkeypatch.setattr("rag_service.qdrant.collection.READ_DELAY_SECONDS", 0)

    with pytest.raises(UnexpectedResponse):
        await ensure_collection(_Loading(failures=100))  # type: ignore[arg-type]


async def test_a_fresh_system_gets_the_collection_and_its_alias():
    client = _Client(create_error=None)

    assert await ensure_collection(client, LOCAL_MODEL)  # type: ignore[arg-type]

    alias = collection_alias(LOCAL_MODEL)
    assert client.aliases == {alias: f"{alias}_1"}


async def test_the_pre_alias_collection_is_adopted_as_geminis():
    client = _Client(create_error=None, existing=(LEGACY_COLLECTION,))

    assert await ensure_collection(client)  # type: ignore[arg-type]

    assert client.aliases == {collection_alias(EMBEDDING_MODEL): LEGACY_COLLECTION}
    assert client.metadata_set == {
        LEGACY_COLLECTION: {"embedding_model": EMBEDDING_MODEL}
    }


async def test_another_models_collection_is_never_adopted():
    # The pre-alias collection holds Gemini's vectors; nomic can't use them.
    client = _Client(create_error=None, existing=(LEGACY_COLLECTION,))

    async def has_vectors() -> bool:
        return False

    assert not await ensure_collection(
        client,  # type: ignore[arg-type]
        LOCAL_MODEL,
        may_create=has_vectors,
    )
    assert client.aliases == {}


async def test_a_model_with_vectors_elsewhere_holds_rather_than_creating():
    client = _Client(create_error=None)

    async def nothing_embedded() -> bool:
        return False

    assert not await ensure_collection(
        client,  # type: ignore[arg-type]
        LOCAL_MODEL,
        may_create=nothing_embedded,
    )
    assert client.existing == set()


async def test_an_alias_on_another_models_collection_fails_naming_both():
    alias = collection_alias(LOCAL_MODEL)
    client = _Client(
        create_error=None, model=EMBEDDING_MODEL, aliases={alias: "elsewhere"}
    )

    with pytest.raises(RuntimeError, match=f"{EMBEDDING_MODEL}.*{LOCAL_MODEL}"):
        await ensure_collection(client, LOCAL_MODEL)  # type: ignore[arg-type]


async def test_the_knowledge_base_refuses_until_the_alias_appears(monkeypatch):
    monkeypatch.setattr(KnowledgeBase, "RECHECK_SECONDS", 0.0)
    client = _Client(create_error=None)

    async def nothing_embedded() -> bool:
        return False

    knowledge = KnowledgeBase(client, LOCAL_MODEL, nothing_embedded)  # type: ignore[arg-type]
    with pytest.raises(KnowledgeBaseRebuilding, match="being rebuilt for nomic"):
        await knowledge.require()

    alias = collection_alias(LOCAL_MODEL)
    client.aliases[alias] = f"{alias}_9"
    client.model = LOCAL_MODEL
    await knowledge.require()
    assert knowledge.ready
