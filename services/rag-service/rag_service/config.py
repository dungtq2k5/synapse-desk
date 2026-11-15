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
    #: Absent in tests, where the embedding client is substituted so the
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

    #: `production` in a cluster, `development` anywhere else. Read only to
    #: refuse the offline model where real answers are expected.
    app_env: str

    #: The model-free provider (`rag_service.offline`), for the end-to-end
    #: stack only. Off by default, and refused under `app_env == "production"`.
    offline_model: bool

    #: Layer B, the cheap-tier classification. On by default — unlike its
    #: predecessor, it costs one label on a call `Chat` was already making, and
    #: it is multilingual because the provider is.
    injection_llm_enabled: bool

    #: `gemini` or `ollama`, per role. Generation can switch with a restart;
    #: embedding is a migration (`npm run ai:reembed`).
    generation_provider: str = "gemini"
    embedding_provider: str = "gemini"
    ollama_base_url: str = ""
    #: The context every Ollama call asks for. Ollama's own default is small
    #: and truncates a long prompt silently.
    ollama_num_ctx: int = 8192
    #: Deadlines, in seconds. An embedding call has a total one; a generation
    #: stream an IDLE one between frames, because a long answer legitimately
    #: takes minutes and a stream that stops sending is the fault.
    gemini_embed_timeout_s: float = 30.0
    gemini_idle_timeout_s: float = 60.0
    #: The idle deadline for a model in `THINKING_MODELS`, which can be slow
    #: to send its first frame.
    gemini_thinking_idle_timeout_s: float = 120.0
    ollama_embed_timeout_s: float = 120.0
    ollama_idle_timeout_s: float = 300.0


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
        app_env=os.environ.get("APP_ENV", "development"),
        offline_model=_flag("RAG_OFFLINE_MODEL", default=False),
        generation_provider=_provider(
            "AI_GENERATION_PROVIDER",
            os.environ.get("AI_GENERATION_PROVIDER", "gemini"),
        ),
        embedding_provider=_provider(
            "AI_EMBEDDING_PROVIDER",
            os.environ.get("AI_EMBEDDING_PROVIDER", "gemini"),
        ),
        ollama_base_url=os.environ.get("OLLAMA_BASE_URL", ""),
        ollama_num_ctx=int(os.environ.get("OLLAMA_NUM_CTX", "8192")),
        gemini_embed_timeout_s=int(os.environ.get("GEMINI_EMBED_TIMEOUT_MS", "30000"))
        / 1000,
        gemini_idle_timeout_s=int(os.environ.get("GEMINI_IDLE_TIMEOUT_MS", "60000"))
        / 1000,
        gemini_thinking_idle_timeout_s=int(
            os.environ.get("GEMINI_THINKING_IDLE_TIMEOUT_MS", "120000")
        )
        / 1000,
        ollama_embed_timeout_s=int(os.environ.get("OLLAMA_EMBED_TIMEOUT_MS", "120000"))
        / 1000,
        ollama_idle_timeout_s=int(os.environ.get("OLLAMA_IDLE_TIMEOUT_MS", "300000"))
        / 1000,
    )


def _provider(name: str, raw: str) -> str:
    """`gemini` (the default) or `ollama`; anything else fails the boot.

    The value is read by the caller, literally, so the env-contract test sees
    the variable's name.
    """
    value = raw.strip().lower() or "gemini"
    if value not in {"gemini", "ollama"}:
        raise RuntimeError(f"{name} is {value!r}; it must be gemini or ollama.")
    return value


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
