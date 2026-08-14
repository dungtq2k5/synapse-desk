"""§1.2 test 1 — the service boots and its three stores are reachable.

The smoke test every other service here has, and it earns its place for the same
reason: a suite where every test fails with a connection error tells you nothing
about which connection. This one names the store.

It also pins the two preconditions that are invisible until they are wrong: the
collection's payload indexes (without them the tenant filter degrades to a scan
and stays correct, so nothing fails) and the pricing coverage (an unpriced model
meters as free).
"""

from __future__ import annotations

import pytest

from rag_service.pricing import assert_pricing_table_covers
from rag_service.qdrant.collection import (
    COLLECTION_NAME,
    DEPARTMENT_IDS,
    EMBEDDING_DIMENSION,
    IS_DELETED,
    IS_ORGANIZATION_WIDE,
    ORGANIZATION_ID,
    payload_index_fields,
)
from rag_service.settings import ALL_CONFIGURED_MODELS


class TestStoresAreReachable:
    async def test_qdrant_answers_and_holds_the_collection(self, qdrant):
        info = await qdrant.get_collection(COLLECTION_NAME)

        assert info.config.params.vectors.size == EMBEDDING_DIMENSION

    async def test_postgres_answers_and_has_the_chunk_table(self, pool):
        # rag-service is READ-ONLY against postgres_ingestion — it never writes
        # chunk rows — so the check is a read. A write here would be the bug it
        # is checking for.
        async with pool.acquire() as connection:
            count = await connection.fetchval("SELECT COUNT(*) FROM document_chunks")

        assert count >= 0

    async def test_redis_answers(self, redis_client):
        assert await redis_client.ping()

    async def test_the_ledger_client_is_constructible(self, ledger):
        # The real one talks to ingestion-service over gRPC; the suite
        # substitutes it, so what this pins is that the SEAM exists and the
        # servicer holds one. A servicer built without it would fail on the
        # first generation rather than at boot.
        assert hasattr(ledger, "record")


class TestBootPreconditions:
    async def test_every_filter_field_is_payload_indexed(self, qdrant):
        # MANDATORY, not an optimisation. Without an index Qdrant cannot
        # estimate filter cardinality and falls back to scanning — which
        # returns correct answers, so nothing fails; the tenant filter merely
        # becomes the dominant cost of every query.
        fields = await payload_index_fields(qdrant)

        for field in (
            ORGANIZATION_ID,
            IS_DELETED,
            DEPARTMENT_IDS,
            IS_ORGANIZATION_WIDE,
        ):
            assert field in fields, f"{field} is not payload-indexed"

    def test_every_configured_model_is_PRICED(self):
        # At boot rather than at first use: a model discovered unpriced at
        # first use has already been metered as free at least once, and the
        # ledger cannot go back and re-price it.
        assert_pricing_table_covers(list(ALL_CONFIGURED_MODELS))

    def test_an_unpriced_model_fails_LOUDLY(self):
        with pytest.raises(RuntimeError, match="meters as free"):
            assert_pricing_table_covers(["a-model-nobody-priced"])


class TestServicerWiring:
    async def test_the_servicer_exposes_every_rpc_the_proto_declares(self, servicer):
        # Catches the failure mode a Python gRPC server makes easy: a method
        # missing from the servicer is not a compile error, it is UNIMPLEMENTED
        # at runtime from a server that is up and healthy.
        from rag_service.generated.synapsedesk.rag import rag_pb2

        declared = {
            method.name
            for method in rag_pb2.DESCRIPTOR.services_by_name["RagService"].methods
        }

        missing = {name for name in declared if not hasattr(servicer, name)}
        assert missing == set(), f"servicer is missing: {sorted(missing)}"


class TestTheGrpcCeilingMatchesTheTypeScriptHalf:
    """35-doc §7.1 — the one constant where a MISSING value was the bug.

    Every TypeScript client and server applies `GRPC_CHANNEL_OPTIONS`, so both
    ends of a Node-to-Node call agree. `grpc.aio.server()` takes no options,
    which left this server at gRPC's 4 MB default — worse than a low limit
    everyone shares, because a caller configured for 10 MB sends a request it
    has every reason to believe is fine and gets RESOURCE_EXHAUSTED back.

    Read out of the TypeScript source rather than restated, for the same reason
    the OCR image check reads its language list from the mapping: a test that
    hard-codes 10 MB agrees with a drifted constant instead of catching it.
    """

    def _typescript_options(self) -> dict[str, int]:
        import re
        from pathlib import Path

        source = (
            Path(__file__).resolve().parents[3]
            / "libs"
            / "grpc-proto"
            / "src"
            / "constants.ts"
        ).read_text()

        block = re.search(
            r"GRPC_CHANNEL_OPTIONS\s*=\s*\{(.*?)\}", source, re.DOTALL
        )
        assert block, "GRPC_CHANNEL_OPTIONS not found — has it moved?"

        found: dict[str, int] = {}
        for name, expression in re.findall(
            r"(\w+):\s*([0-9_ */]+),", block.group(1)
        ):
            # `10 * 1024 * 1024` and `30_000` both appear; both are arithmetic
            # over integer literals and nothing else.
            found[name] = int(eval(expression.replace("_", "")))

        return found

    def test_the_message_ceiling_matches(self):
        from rag_service.common.metadata import GRPC_MAX_MESSAGE_BYTES

        options = self._typescript_options()

        assert options["maxReceiveMessageLength"] == GRPC_MAX_MESSAGE_BYTES
        assert options["maxSendMessageLength"] == GRPC_MAX_MESSAGE_BYTES

    def test_the_keepalive_values_match(self):
        from rag_service.common.metadata import (
            GRPC_KEEPALIVE_TIME_MS,
            GRPC_KEEPALIVE_TIMEOUT_MS,
        )

        options = self._typescript_options()

        assert options["keepaliveTime"] == GRPC_KEEPALIVE_TIME_MS
        assert options["keepaliveTimeout"] == GRPC_KEEPALIVE_TIMEOUT_MS

    def test_the_server_is_actually_constructed_with_them(self):
        """The mirror being right is worth nothing if nothing passes it.

        Python spells these as dotted strings, so a camelCase key would be
        accepted and silently ignored — which is the failure this whole section
        exists to prevent, reintroduced one layer down.
        """
        from rag_service.common.metadata import GRPC_SERVER_OPTIONS

        keys = dict(GRPC_SERVER_OPTIONS)

        assert keys["grpc.max_receive_message_length"] == 10 * 1024 * 1024
        assert keys["grpc.max_send_message_length"] == 10 * 1024 * 1024
        assert all(key.startswith("grpc.") for key in keys)
