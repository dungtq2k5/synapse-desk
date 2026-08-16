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

    # ------------------------------------------------- prompt injection
    #
    # **Here rather than in `AiSettings`, and that is the decision.**
    # `AiSettings` is resolved per tenant from another service's column, so a
    # kill switch there would hand every tenant the ability to switch off a
    # security layer — which is what one false positive will make somebody do.
    # These are environment variables, which means tunable with a RESTART; for
    # a switch touched twice a year that is the right trade, and claiming
    # "without a deploy" would promise something the mechanism does not do.
    #
    # **Two flags, not four.** An earlier design ran a local ONNX classifier and
    # needed a model path and a score threshold; that approach was measured and
    # was measured and rejected. Layer B is now a cheap-tier call whose model
    # comes from `settings.cheap_model` — already resolved per tenant — and
    # whose answer is a label rather than a score, so neither setting has
    # anything left to configure.

    #: Layer A, the pattern pass. On by default: it is free, and off by default
    #: would mean the common deployment has no injection defence at all.
    injection_regex_enabled: bool

    #: Layer B, the cheap-tier classification. On by default — unlike its
    #: predecessor, it costs one label on a call `Chat` was already making, and
    #: it is multilingual because the provider is.
    injection_llm_enabled: bool


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
        # `.get` with defaults, unlike the addresses above: both have a correct
        # answer without an environment that mentions them, and a service that
        # refused to boot because nobody set a kill switch would be the wrong
        # kind of strict.
        injection_regex_enabled=_flag("INJECTION_REGEX_ENABLED", default=True),
        injection_llm_enabled=_flag("INJECTION_LLM_ENABLED", default=True),
    )


def _flag(name: str, *, default: bool) -> bool:
    """An env var read as a boolean, accepting what people actually write.

    `bool(os.environ.get(...))` is the trap this avoids: it reads "false" as
    True, which for a security kill switch means the string that most looks
    like "off" turns the layer ON.
    """
    raw = os.environ.get(name)
    if raw is None:
        return default

    return raw.strip().lower() in {"1", "true", "yes", "on"}
