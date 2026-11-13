"""The Qdrant collections, their payload indexes, and the pin on the embedding model.

**One collection per embedding model, payload-partitioned by tenant**, each
reached through an alias named for its model (`collection_alias`). Not
collection-per-tenant: Qdrant carries per-collection overhead that degrades past
a few hundred, and its own multitenancy guidance is payload partitioning. The
consequence is that the tenant boundary lives inside a *filter* rather than
inside a *namespace*, which is precisely why `tenant_scope()` exists and why its
tests are the ones that matter most in Domain C.

**The alias exists only when its collection is complete.** Vectors from two
models share a dimension (768) but not a space, so a query embedded by one model
against the other's vectors returns no error, only meaningless neighbors. A
service whose model has no alias therefore searches nothing: rag-service answers
retrieval `UNAVAILABLE` and ingestion-service holds its work, until
`npm run ai:reembed` builds the collection and creates the alias.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qm
from qdrant_client.http.exceptions import UnexpectedResponse

from rag_service.settings import EMBEDDING_MODEL as SETTINGS_EMBEDDING_MODEL

logger = logging.getLogger(__name__)

#: The prefix of every alias and collection, and the name of the one collection
#: that existed before aliases: Gemini's, adopted under its alias at boot.
COLLECTION_PREFIX = "document_chunks"
LEGACY_COLLECTION = COLLECTION_PREFIX

#: Gemini's embedding model, the default provider's, and the model the legacy
#: collection was built with. Imported rather than restated: this file and the
#: settings layer MUST agree, and two constants that must agree are one constant.
EMBEDDING_MODEL = SETTINGS_EMBEDDING_MODEL
EMBEDDING_DIMENSION = 768

#: Where a collection records the model its vectors came from. Aliases carry no
#: metadata, so the collection is the only place it can live.
MODEL_METADATA_KEY = "embedding_model"


def collection_alias(model: str) -> str:
    """The alias both services address for one embedding model.

    Sanitized to `[a-z0-9_-]`, because a pinned tag carries a colon and a dot.

    >>> collection_alias("Some-Model:v1.5")
    'document_chunks__some-model_v1_5'
    """
    return f"{COLLECTION_PREFIX}__{re.sub(r'[^a-z0-9_-]', '_', model.lower())}"


#: The default model's alias: what the tests and the eval harness address.
COLLECTION_NAME = collection_alias(EMBEDDING_MODEL)


class KnowledgeBaseRebuilding(RuntimeError):
    """The configured model's collection isn't complete yet: no alias."""

    def __init__(self, model: str) -> None:
        super().__init__(
            f"The knowledge base is being rebuilt for {model}. Try again in a minute."
        )
        self.model = model


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

#: A chunk of a version ingestion-service is still building beside the live
#: one. Retrieval skips it until the run's swap clears it. A point written
#: before the field existed has no value and counts as live.
IS_STAGED = "is_staged"


@dataclass(frozen=True)
class CollectionMetadata:
    """What the collection was created with, read back for comparison."""

    model: str
    dimension: int


async def _always() -> bool:
    return True


async def ensure_collection(
    client: AsyncQdrantClient,
    model: str = EMBEDDING_MODEL,
    *,
    may_create: Callable[[], Awaitable[bool]] = _always,
) -> bool:
    """Makes `model`'s alias usable if it can; returns whether it is.

    In order:

    1. **The alias exists:** its collection's model and dimension are checked
       (a mismatch fails the boot, naming both models) and its indexes ensured.
    2. **Gemini, and the pre-alias `document_chunks` collection exists:** that
       collection IS Gemini's, so it is adopted under Gemini's alias, its model
       recorded. Existing deployments keep serving with no rebuild.
    3. **`may_create()` says nothing has been embedded yet** (a fresh system):
       the collection is created empty, with its alias.
    4. **Otherwise** the model has no complete collection: `False`, and the
       caller holds retrieval until `npm run ai:reembed` builds one.

    Idempotent and safe across replicas and alongside ingestion-service: a
    create that loses the race gets Qdrant's 409 and goes on as if it found the
    collection. Any other failure fails the boot.

    **Creating the collection is not the interesting part; the indexes are.**
    A collection with no payload indexes works perfectly in a test with fifty
    points and degrades to a scan in production.
    """
    alias = collection_alias(model)

    target = await alias_target(client, alias)
    if target is not None:
        await _assert_model_matches(client, target, model)
        await _ensure_payload_indexes(client, target)
        return True

    if model == EMBEDDING_MODEL and await client.collection_exists(LEGACY_COLLECTION):
        await _assert_model_matches(client, LEGACY_COLLECTION, model)
        await client.update_collection(
            collection_name=LEGACY_COLLECTION, metadata={MODEL_METADATA_KEY: model}
        )
        await _ensure_payload_indexes(client, LEGACY_COLLECTION)
        await _create_alias(client, LEGACY_COLLECTION, alias)
        logger.info("Adopted %s as %s (%s)", LEGACY_COLLECTION, alias, model)
        return True

    if not await may_create():
        return False

    name = f"{alias}_1"
    if await create_collection(client, name, model):
        logger.info(
            "Created Qdrant collection %s (%s, %d-dim)",
            name,
            model,
            EMBEDDING_DIMENSION,
        )
    await _create_alias(client, name, alias)
    return True


async def create_collection(client: AsyncQdrantClient, name: str, model: str) -> bool:
    """Creates one model's collection with its indexes; `False` if it existed.

    Also what `ai:reembed` builds a new collection with, so both paths record
    the model and create the same indexes.
    """
    try:
        await client.create_collection(
            collection_name=name,
            vectors_config=qm.VectorParams(
                size=EMBEDDING_DIMENSION,
                distance=qm.Distance.COSINE,
            ),
            metadata={MODEL_METADATA_KEY: model},
        )
    except UnexpectedResponse as error:
        if error.status_code != 409:
            raise
        await _assert_model_matches(client, name, model)
        await _ensure_payload_indexes(client, name)
        return False

    await _ensure_payload_indexes(client, name)
    return True


async def alias_target(client: AsyncQdrantClient, alias: str) -> str | None:
    """The collection an alias points at, or `None`."""
    response = await client.get_aliases()
    for entry in response.aliases:
        if entry.alias_name == alias:
            return entry.collection_name
    return None


async def _create_alias(client: AsyncQdrantClient, collection: str, alias: str) -> None:
    """Points `alias` at `collection`, unless a racing replica already did."""
    if await alias_target(client, alias) == collection:
        return
    await client.update_collection_aliases(
        change_aliases_operations=[
            qm.CreateAliasOperation(
                create_alias=qm.CreateAlias(
                    collection_name=collection, alias_name=alias
                )
            )
        ]
    )


@dataclass
class KnowledgeBase:
    """The configured model's alias, and whether it is ready to search.

    Not ready means `ensure_collection` found no complete collection for the
    model. Re-checked at most every `RECHECK_SECONDS`, so the alias
    `ai:reembed` creates is picked up without a restart.
    """

    client: AsyncQdrantClient
    model: str
    may_create: Callable[[], Awaitable[bool]] = _always
    ready: bool = False
    checked_at: float = float("-inf")

    RECHECK_SECONDS = 10.0

    @property
    def alias(self) -> str:
        return collection_alias(self.model)

    async def require(self) -> None:
        """Returns when the alias is usable; raises `KnowledgeBaseRebuilding` if not."""
        if self.ready:
            return
        if time.monotonic() - self.checked_at >= self.RECHECK_SECONDS:
            self.checked_at = time.monotonic()
            self.ready = await ensure_collection(
                self.client, self.model, may_create=self.may_create
            )
        if not self.ready:
            raise KnowledgeBaseRebuilding(self.model)


async def _ensure_payload_indexes(client: AsyncQdrantClient, collection: str) -> None:
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
        (IS_STAGED, qm.PayloadSchemaType.BOOL),
        # Not part of the filter. Indexed because the re-scoping fan-out
        # updates every point of one document, and without this
        # that update scans the whole collection.
        (DOCUMENT_ID, qm.PayloadSchemaType.KEYWORD),
    ]

    for field_name, schema in specs:
        try:
            await client.create_payload_index(
                collection_name=collection,
                field_name=field_name,
                field_schema=schema,
            )
        except Exception as error:
            # Deliberately broad, and deliberately non-fatal: a duplicate index
            # is reported differently across Qdrant versions and is not an
            # error in any of them. Re-raising would make a successful boot
            # depend on which server version happened to be running.
            #
            # A genuinely missing index is caught by the test that asserts every one
            # exists, not by this line.
            logger.debug(
                "Payload index %s already present or unsupported: %s", field_name, error
            )


#: How long a collection another service just created may take to load.
READ_ATTEMPTS = 20
READ_DELAY_SECONDS = 0.5


async def _read_collection(
    client: AsyncQdrantClient, collection: str
) -> qm.CollectionInfo:
    """The collection's info, once it has loaded.

    A collection ingestion-service created a moment ago already "exists" but
    answers 500 ("0 of 0 read operations failed") until its shards load, so a
    5xx is waited out for a few seconds rather than failing the boot.
    """
    for attempt in range(READ_ATTEMPTS):
        try:
            return await client.get_collection(collection)
        except UnexpectedResponse as error:
            if error.status_code is None or error.status_code < 500:
                raise
            if attempt == READ_ATTEMPTS - 1:
                raise
            await asyncio.sleep(READ_DELAY_SECONDS)
    raise AssertionError("unreachable")


async def _assert_model_matches(
    client: AsyncQdrantClient, collection: str, model: str
) -> None:
    """Refuses a collection built by another model, or for another vector size.

    The dimension is the only part Qdrant itself enforces (at insert time, with
    an opaque error). The model is the part it can't: a same-dimension
    *different* model produces no error at all, just quietly meaningless
    neighbors. So the model a collection records is compared here, and a
    mismatch fails the boot naming both. A collection that records none is the
    pre-alias one, which only Gemini's model ever wrote.
    """
    info = await _read_collection(client, collection)
    params = info.config.params.vectors

    size = params.size if isinstance(params, qm.VectorParams) else None
    if size is not None and size != EMBEDDING_DIMENSION:
        raise RuntimeError(
            f"Collection '{collection}' has {size}-dimensional vectors but "
            f"{model} produces {EMBEDDING_DIMENSION}. Changing the "
            "embedding model is a full re-embed migration, not a config change."
        )

    metadata = getattr(info.config, "metadata", None) or {}
    recorded = metadata.get(MODEL_METADATA_KEY, EMBEDDING_MODEL)
    if recorded != model:
        raise RuntimeError(
            f"Collection '{collection}' holds {recorded} vectors but is reached "
            f"as {model}'s. Its alias points at the wrong collection; run "
            f"`npm run ai:reembed -- --model <provider>` to rebuild it."
        )


async def payload_index_fields(
    client: AsyncQdrantClient, collection: str = COLLECTION_NAME
) -> set[str]:
    """The payload fields that actually carry an index, for the tests.

    Read back from the server rather than from the spec above, because the
    thing worth asserting is what Qdrant has — not what this file intended.
    """
    info = await client.get_collection(collection)

    return set(info.payload_schema.keys())
