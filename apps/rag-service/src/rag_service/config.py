"""Environment, read once.

No settings-layer indirection here yet — that is build-order step 3b, and it
covers MODEL choices rather than infrastructure URLs. These are the addresses of
things, which no tenant configures.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    qdrant_url: str
    ingestion_database_url: str
    redis_url: str
    redis_db: int
    grpc_host: str
    grpc_port: int
    #: `ingestion-service`, for the durable ledger row. The quota COUNTER does
    #: not go through it — that is a direct Redis INCRBY (RDM §1.14).
    ingestion_service_url: str
    #: Absent in tests, where the embedding client is substituted (§2.6) so the
    #: retrieval suite needs no API key, no network and no per-run spend.
    gemini_api_key: str


def load_config() -> Config:
    """Reads the environment, failing LOUDLY on anything missing.

    `os.environ[...]` rather than `.get(...)`: a missing Qdrant URL that
    defaulted to localhost would connect to whatever happened to be there,
    which in a container is nothing and in a developer's shell might be
    production.
    """
    return Config(
        qdrant_url=os.environ["QDRANT_URL"],
        ingestion_database_url=os.environ["INGESTION_DATABASE_URL"],
        redis_url=os.environ["REDIS_URL"],
        redis_db=int(os.environ.get("REDIS_DB", "0")),
        grpc_host=os.environ.get("GRPC_HOST", "0.0.0.0"),
        grpc_port=int(os.environ.get("GRPC_PORT", "50255")),
        ingestion_service_url=os.environ["INGESTION_SERVICE_URL"],
        # `.get`, not `[...]`, and it is the ONE exception to the rule above:
        # the test environment substitutes the embedding client entirely, so
        # requiring a key here would mean every contributor needs a paid
        # account to run the retrieval suite.
        gemini_api_key=os.environ.get("GEMINI_API_KEY", ""),
    )
