"""Retrieval while the configured embedding model has no complete collection.

Through a real gRPC server with the boot's interceptor, so what is asserted is
the status and text a caller receives, not what a handler raised.
"""

from __future__ import annotations

import grpc
import pytest

from rag_service.common.metadata import CONTEXT_METADATA
from rag_service.generated.synapsedesk.rag import rag_pb2, rag_pb2_grpc
from rag_service.qdrant.collection import KnowledgeBase
from rag_service.server import KnowledgeBaseInterceptor

#: A model no collection exists for, whatever the shared Qdrant holds: the
#: state an env flip without `ai:reembed` produces.
MODEL = "embedder-with-no-collection"
REFUSAL = (
    f"[http:503;retry-after=60] The knowledge base is being rebuilt for {MODEL}. "
    "Try again in a minute."
)


@pytest.fixture
async def stub(servicer, qdrant, tenant_a):
    async def something_embedded() -> bool:
        return False

    # A model whose alias doesn't exist, on a system with vectors elsewhere:
    # exactly what an env flip without `ai:reembed` produces.
    servicer._deps.knowledge = KnowledgeBase(qdrant, MODEL, something_embedded)
    servicer._retrieval = servicer._deps.retrieval()

    server = grpc.aio.server(interceptors=[KnowledgeBaseInterceptor()])
    rag_pb2_grpc.add_RagServiceServicer_to_server(servicer, server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{port}")
    metadata = (
        (CONTEXT_METADATA["organization_id"], tenant_a.organization_id),
        (CONTEXT_METADATA["user_id"], "00000000-0000-0000-0000-000000000001"),
    )
    try:
        yield rag_pb2_grpc.RagServiceStub(channel), metadata
    finally:
        await channel.close()
        await server.stop(None)


async def test_ask_answers_unavailable_with_the_rebuilding_text(stub):
    client, metadata = stub

    with pytest.raises(grpc.aio.AioRpcError) as raised:
        await client.Ask(
            rag_pb2.ChatRequest(message="What is the refund policy?"),
            metadata=metadata,
        )

    assert raised.value.code() == grpc.StatusCode.UNAVAILABLE
    assert raised.value.details() == REFUSAL


async def test_search_answers_the_same(stub):
    client, metadata = stub

    with pytest.raises(grpc.aio.AioRpcError) as raised:
        await client.Search(rag_pb2.SearchRequest(query="refund"), metadata=metadata)

    assert raised.value.code() == grpc.StatusCode.UNAVAILABLE
    assert raised.value.details() == REFUSAL


async def test_the_chat_stream_ends_with_the_same_status(stub):
    client, metadata = stub

    with pytest.raises(grpc.aio.AioRpcError) as raised:
        async for _ in client.Chat(
            rag_pb2.ChatRequest(message="What is the refund policy for laptops?"),
            metadata=metadata,
        ):
            pass

    assert raised.value.code() == grpc.StatusCode.UNAVAILABLE
    assert raised.value.details() == REFUSAL
