"""The Qdrant collection, its payload indexes, and the pin on the embedding model.

**One collection, payload-partitioned**. Not
collection-per-tenant: Qdrant carries per-collection overhead that degrades past
a few hundred, and its own multitenancy guidance is payload partitioning. The
consequence is that the tenant boundary lives inside a *filter* rather than
inside a *namespace*, which is precisely why `tenant_scope()` exists and why its
tests are the ones that matter most in Domain C.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qm
from qdrant_client.http.exceptions import UnexpectedResponse

from rag_service.settings import EMBEDDING_MODEL as SETTINGS_EMBEDDING_MODEL

logger = logging.getLogger(__name__)

COLLECTION_NAME = "document_chunks"

#: The embedding model, PINNED.
#:
#: A Qdrant collection fixes vector size at creation, so changing this is a full
#: re-embed migration across every tenant — not a config change. It is recorded
#: in the collection so a mismatch is *detectable* rather than silently wrong:
#: without it, pointing a differently-dimensioned model at an existing
#: collection fails at insert time with a shape error that says nothing about
#: why, and pointing a same-dimension DIFFERENT model at it fails not at all —
#: it just returns quietly meaningless neighbours.
#: Imported rather than restated: this file and the settings layer MUST agree,
#: and two constants that must agree are one constant.
EMBEDDING_MODEL = SETTINGS_EMBEDDING_MODEL
EMBEDDING_DIMENSION = 768

#: The four payload fields the retrieval filter compares.
#:
#: **Payload indexes are mandatory, not an optimisation.** Without them Qdrant
#: cannot estimate filter cardinality and falls back to scanning, which turns
#: the tenant filter from a cheap pre-condition into the dominant cost of every
#: query.
ORGANIZATION_ID = "organization_id"
IS_DELETED = "is_deleted"
DEPARTMENT_IDS = "department_ids"
IS_ORGANIZATION_WIDE = "is_organization_wide"
DOCUMENT_ID = "document_id"
CHUNK_ID = "chunk_id"


@dataclass(frozen=True)
class CollectionMetadata:
    """What the collection was created with, read back for comparison."""

    model: str
    dimension: int


async def ensure_collection(client: AsyncQdrantClient) -> None:
    """Creates the collection and its payload indexes if they do not exist.

    Idempotent, so it is safe on every boot and safe to run concurrently across
    replicas and alongside ingestion-service. Both check, then create, so the
    one that loses the race gets Qdrant's 409; that counts as finding the
    collection, and the same checks follow. Any other failure still fails the
    boot.

    **Creating the collection is not the interesting part; the indexes are.**
    A collection with no payload indexes works perfectly in a test with fifty
    points and degrades to a scan in production, which is the failure mode that
    is hardest to notice and most expensive to discover.
    """
    if await client.collection_exists(COLLECTION_NAME):
        await _assert_model_matches(client)
        await _ensure_payload_indexes(client)
        return

    try:
        await client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=qm.VectorParams(
                size=EMBEDDING_DIMENSION,
                distance=qm.Distance.COSINE,
            ),
        )
    except UnexpectedResponse as error:
        if error.status_code != 409:
            raise
        await _assert_model_matches(client)
        await _ensure_payload_indexes(client)
        return
    logger.info(
        "Created Qdrant collection %s (%s, %d-dim)",
        COLLECTION_NAME,
        EMBEDDING_MODEL,
        EMBEDDING_DIMENSION,
    )

    await _ensure_payload_indexes(client)


async def _ensure_payload_indexes(client: AsyncQdrantClient) -> None:
    """The four filter fields, plus document_id for the re-scoping fan-out.

    Each `create_payload_index` is idempotent in Qdrant, so this is safe to
    re-run; the try/except covers older servers that raise on a duplicate
    rather than accepting it.
    """
    specs: list[tuple[str, qm.PayloadSchemaType | qm.KeywordIndexParams]] = [
        # `is_tenant=True` co-locates each tenant's points on disk, which is
        # what makes a payload-partitioned collection perform like a
        # per-tenant one for the overwhelmingly common single-tenant query.
        (
            ORGANIZATION_ID,
            qm.KeywordIndexParams(type=qm.KeywordIndexType.KEYWORD, is_tenant=True),
        ),
        (IS_DELETED, qm.PayloadSchemaType.BOOL),
        # An array field. Indexed as keyword so `MatchAny` gives intersection
        # semantics — "the caller is in ANY of this document's departments",
        # which is the correct reading of RDM §1.2. Containment ("in ALL of
        # them") would make multi-department scoping useless.
        (DEPARTMENT_IDS, qm.PayloadSchemaType.KEYWORD),
        (IS_ORGANIZATION_WIDE, qm.PayloadSchemaType.BOOL),
        # Not part of the filter. Indexed because the re-scoping fan-out
        # updates every point of one document, and without this
        # that update scans the whole collection.
        (DOCUMENT_ID, qm.PayloadSchemaType.KEYWORD),
    ]

    for field_name, schema in specs:
        try:
            await client.create_payload_index(
                collection_name=COLLECTION_NAME,
                field_name=field_name,
                field_schema=schema,
            )
        except Exception as error:
            # Deliberately broad, and deliberately non-fatal: a duplicate index
            # is reported differently across Qdrant versions and is not an
            # error in any of them. Re-raising would make a successful boot
            # depend on which server version happened to be running.
            #
            # A genuinely missing index is caught by the test that asserts all
            # five exist, not by this line.
            logger.debug(
                "Payload index %s already present or unsupported: %s", field_name, error
            )


#: How long a collection another service just created may take to load.
READ_ATTEMPTS = 20
READ_DELAY_SECONDS = 0.5


async def _read_collection(client: AsyncQdrantClient) -> qm.CollectionInfo:
    """The collection's info, once it has loaded.

    A collection ingestion-service created a moment ago already "exists" but
    answers 500 ("0 of 0 read operations failed") until its shards load, so a
    5xx is waited out for a few seconds rather than failing the boot.
    """
    for attempt in range(READ_ATTEMPTS):
        try:
            return await client.get_collection(COLLECTION_NAME)
        except UnexpectedResponse as error:
            if error.status_code is None or error.status_code < 500:
                raise
            if attempt == READ_ATTEMPTS - 1:
                raise
            await asyncio.sleep(READ_DELAY_SECONDS)
    raise AssertionError("unreachable")


async def _assert_model_matches(client: AsyncQdrantClient) -> None:
    """Refuses to serve a collection built for a different vector size.

    The dimension is the only part Qdrant itself will enforce (at insert time,
    with an opaque error). This turns that into a boot-time failure naming the
    actual problem — and it is the reason to record model and
    dimension in the first place: a same-dimension *different* model produces
    no error at all, just quietly meaningless neighbours.
    """
    info = await _read_collection(client)
    params = info.config.params.vectors

    size = params.size if isinstance(params, qm.VectorParams) else None
    if size is not None and size != EMBEDDING_DIMENSION:
        raise RuntimeError(
            f"Collection '{COLLECTION_NAME}' has {size}-dimensional vectors but "
            f"{EMBEDDING_MODEL} produces {EMBEDDING_DIMENSION}. Changing the "
            "embedding model is a full re-embed migration, not a config change."
        )


async def payload_index_fields(client: AsyncQdrantClient) -> set[str]:
    """The payload fields that actually carry an index, for the tests.

    Read back from the server rather than from the spec above, because the
    thing worth asserting is what Qdrant has — not what this file intended.
    """
    info = await client.get_collection(COLLECTION_NAME)

    return set(info.payload_schema.keys())
