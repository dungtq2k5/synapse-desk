"""Every model call has a deadline: a provider that accepts and never answers.

The fault this guards is the one that held `ai:reembed` open for hours: a
request accepted and never answered, with nothing to end it.
"""

from __future__ import annotations

import asyncio
import socket
import threading
import time
from collections.abc import Iterator

import httpx
import pytest

from rag_service.embeddings import GeminiEmbeddingClient
from rag_service.generation.gemini import GeminiGenerator
from rag_service.ollama import OllamaEmbeddingClient, OllamaGenerator
from rag_service.settings import MODELS_BY_PROVIDER

GEMINI = MODELS_BY_PROVIDER["gemini"]
OLLAMA = MODELS_BY_PROVIDER["ollama"]


@pytest.fixture
def silent() -> Iterator[str]:
    """A server that accepts every connection and never answers."""
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    held: list[socket.socket] = []
    stop = threading.Event()

    def accept() -> None:
        listener.settimeout(0.1)
        while not stop.is_set():
            try:
                held.append(listener.accept()[0])
            except TimeoutError:
                continue

    thread = threading.Thread(target=accept, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{listener.getsockname()[1]}"
    finally:
        stop.set()
        thread.join()
        for connection in held:
            connection.close()
        listener.close()


@pytest.fixture
def gemini_at(silent, monkeypatch) -> str:
    from google.genai import _base_url

    monkeypatch.setattr(_base_url, "_default_base_gemini_url", silent)
    return silent


async def _fails_within(call, seconds: float) -> None:
    started = time.monotonic()
    # httpx's own deadline, which both SDK paths surface unwrapped.
    with pytest.raises(httpx.TimeoutException):
        await asyncio.wait_for(call, timeout=10)
    assert time.monotonic() - started < seconds


async def test_gemini_embedding_gives_up_at_its_deadline(gemini_at):
    client = GeminiEmbeddingClient("key", timeout_s=0.3)

    await _fails_within(client.embed_query("q", GEMINI["embedding_model"]), 5)


async def test_gemini_generation_gives_up_when_the_stream_goes_quiet(gemini_at):
    generator = GeminiGenerator("key", idle_timeout_s=0.3)

    with pytest.raises(TimeoutError, match="sent nothing for 0.3 s"):
        await asyncio.wait_for(
            generator.generate("q", GEMINI["cheap_model"], 16), timeout=10
        )


async def test_ollama_embedding_gives_up_at_its_deadline(silent):
    client = OllamaEmbeddingClient(silent, 8192, timeout_s=0.3)

    with pytest.raises(TimeoutError, match="no embedding for 0.3 s"):
        await asyncio.wait_for(
            client.embed_query("q", OLLAMA["embedding_model"]), timeout=10
        )


async def test_ollama_generation_gives_up_when_the_stream_goes_quiet(silent):
    generator = OllamaGenerator(silent, 8192, idle_timeout_s=0.3)

    await _fails_within(generator.generate("q", OLLAMA["cheap_model"], 16), 5)
