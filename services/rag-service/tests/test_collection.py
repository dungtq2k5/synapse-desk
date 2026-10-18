"""Booting against a collection another service is creating at the same moment."""

from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest
from qdrant_client.http import models as qm
from qdrant_client.http.exceptions import UnexpectedResponse

from rag_service.qdrant.collection import EMBEDDING_DIMENSION, ensure_collection


def _refusal(status: int, reason: str) -> UnexpectedResponse:
    return UnexpectedResponse(
        status_code=status,
        reason_phrase=reason,
        content=b'{"status":{"error":"Wrong input: Collection `document_chunks` already exists!"}}',
        headers=httpx.Headers(),
    )


class _Client:
    """Qdrant with no collection yet, whose create answers `create_error`."""

    def __init__(self, create_error: Exception | None, size: int = EMBEDDING_DIMENSION):
        self.create_error = create_error
        self.size = size
        self.indexed: list[str] = []
        self.read_back = False

    async def collection_exists(self, _name: str) -> bool:
        return False

    async def create_collection(self, **_kwargs: object) -> bool:
        if self.create_error is not None:
            raise self.create_error
        return True

    async def get_collection(self, _name: str) -> SimpleNamespace:
        self.read_back = True
        vectors = qm.VectorParams(size=self.size, distance=qm.Distance.COSINE)
        return SimpleNamespace(
            config=SimpleNamespace(params=SimpleNamespace(vectors=vectors))
        )

    async def create_payload_index(self, *, field_name: str, **_kwargs: object) -> bool:
        self.indexed.append(field_name)
        return True


async def test_creates_a_missing_collection_and_its_indexes():
    client = _Client(create_error=None)

    await ensure_collection(client)  # type: ignore[arg-type]

    assert not client.read_back
    assert len(client.indexed) == 5


async def test_a_create_that_loses_the_race_goes_on_as_if_it_found_the_collection():
    client = _Client(create_error=_refusal(409, "Conflict"))

    await ensure_collection(client)  # type: ignore[arg-type]

    assert client.read_back
    assert len(client.indexed) == 5


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
