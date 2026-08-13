"""§1.4 test 7 — every LLM call site obtains its model from the settings layer.

*"The one that catches a new call site added six months from now."*

The lint in `scripts/check-model-literals.mjs` catches a model NAME typed at a
call site. It cannot catch the subtler version: a call site that passes a model
resolved somewhere other than `settings_for()` — read from an environment
variable, defaulted in a helper, or copied off a neighbouring request. Those
compile, pass every other test, and quietly hand a premium tenant the cheap
model.

So this asserts the property from the other end: every provider call this
service makes receives a model that came out of `AiSettings`, and nothing else.
"""

from __future__ import annotations

import ast
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import ClassVar

import pytest

import rag_service
from rag_service.enums import AiGenerationPurpose
from rag_service.generation.copilot import CopilotService
from rag_service.generation.corag import CoRagGenerator, GenerationDelta
from rag_service.preprocess.pipeline import PreprocessPipeline, Turn
from rag_service.retrieval.service import BudgetState, HydratedChunk
from rag_service.settings import AiSettings, resolve_ai_settings

# Derived from the IMPORTED package rather than spelled as a relative path, so
# the scan follows the package wherever it lives. The literal version silently
# scanned nothing when the `src/` layer was removed — the guard assertions below
# caught it, which is exactly why they are there, but the scan should not need
# catching in the first place.
SOURCE_ROOT = Path(rag_service.__file__).resolve().parent
CYCLE = datetime(2026, 8, 1, tzinfo=timezone.utc)


class ModelRecordingGenerator:
    """Records the model every provider call was handed."""

    def __init__(self) -> None:
        self.models: list[str] = []

    async def stream(self, prompt: str, model: str, max_output_tokens: int):
        self.models.append(model)

        yield GenerationDelta(text='{"summary":"s","action":"a","confidence":1}')
        yield GenerationDelta(done=True, prompt_tokens=10, completion_tokens=2)

    async def generate(self, prompt: str, model: str, max_output_tokens: int):
        from rag_service.preprocess.pipeline import GenerationOutput

        self.models.append(model)

        return GenerationOutput(text="FACTUAL", prompt_tokens=10, completion_tokens=1)


class NullQuota:
    async def charge(self, *_args, **_kwargs):
        return None


@pytest.fixture
def settings() -> AiSettings:
    return resolve_ai_settings("QUALITY")


@pytest.fixture
def budget():
    return BudgetState(organization_id="org", cycle_start=CYCLE, allows_embedding=True)


@pytest.fixture
def generator() -> ModelRecordingGenerator:
    return ModelRecordingGenerator()


def chunk() -> HydratedChunk:
    return HydratedChunk(
        chunk_id="chunk-1",
        document_id="doc-1",
        document_title="Handbook",
        page_number=1,
        chunk_index=0,
        content_text="Policy text.",
        score=1.0,
        vector_point_id="point-1",
    )


class TestEverySurfaceUsesResolvedModels:
    """Per surface, as the doc asks — a new one is a new test that fails."""

    async def test_chat_generation_uses_the_resolved_generation_model(
        self, generator, ledger, settings, budget
    ):
        corag = CoRagGenerator(generator, ledger, NullQuota())

        await corag.generate(
            "q",
            [chunk()],
            settings,
            budget=budget,
            purpose=AiGenerationPurpose.CHAT_ANSWER,
            retrieved_chunk_ids=["chunk-1"],
        )

        assert generator.models == [settings.generation_model]

    async def test_the_review_loop_uses_resolved_models_on_BOTH_passes(
        self, generator, ledger, settings, budget
    ):
        corag = CoRagGenerator(generator, ledger, NullQuota())

        await corag.generate_reviewed(
            "q",
            [chunk()],
            settings,
            budget=budget,
            purpose=AiGenerationPurpose.DRAFT,
            retrieved_chunk_ids=["chunk-1"],
            max_retries=1,
        )

        # Every model handed to the provider is one of the two the settings
        # layer resolved — never a third from anywhere else.
        assert set(generator.models) <= {
            settings.generation_model,
            settings.cheap_model,
        }
        assert settings.cheap_model in generator.models

    async def test_greeting_classification_and_reformulation_use_resolved_models(
        self, generator, ledger, settings, budget
    ):
        pipeline = PreprocessPipeline(generator, ledger, NullQuota())

        await pipeline.run(
            "tell me more about it",
            [Turn(role="user", content="what is the limit?")],
            settings,
            budget=budget,
        )

        assert set(generator.models) == {settings.cheap_model}

    @pytest.mark.parametrize(
        "surface",
        ["summarize", "classify", "suggest"],
    )
    async def test_every_copilot_surface_uses_a_resolved_model(
        self, surface, generator, ledger, settings, budget
    ):
        copilot = CopilotService(generator, ledger, NullQuota())

        if surface == "summarize":
            await copilot.summarize(
                "t", "user: hi", settings, budget=budget, triggered_by_escalation=False
            )
        elif surface == "classify":
            await copilot.classify(
                "t", "title", "body", [("d1", "IT")], settings, budget=budget
            )
        else:
            await copilot.suggest("t", "user: hi", settings, budget=budget)

        assert generator.models
        assert set(generator.models) <= {
            settings.generation_model,
            settings.cheap_model,
        }


class TestNoCallSiteResolvesItsOwnModel:
    """The static half — what a runtime test cannot reach.

    A surface added six months from now might simply not be covered above. This
    scans the source instead, so a new provider call has to opt IN to being
    correct rather than merely avoiding a test.
    """

    #: The parameters through which a model legitimately arrives at a provider.
    #:
    #: Every one is a field of `AiSettings`. A call passing anything else is
    #: either resolving its own model or forwarding one from a request — and the
    #: second is worse, because it lets a caller choose the premium tier for
    #: free (11-doc §1.7).
    #: `ClassVar`, because this is shared constant data rather than per-instance
    #: state — the annotation is what stops one test mutating the set every
    #: later test then scans against.
    ALLOWED: ClassVar[set[str]] = {
        "settings.generation_model",
        "settings.cheap_model",
        "settings.embedding_model",
        "model",
    }

    #: Receivers that ARE a model provider.
    #:
    #: Matched on the receiver rather than the method name alone, because
    #: `generate` is also the name of `CoRagGenerator`'s own unary helper — and
    #: counting that would flag `corag.generate(query, chunks, ...)` for passing
    #: `chunks` as a model. The distinction that matters is who is being CALLED.
    PROVIDER_RECEIVERS = ("_generator", "_embeddings", "generator", "embeddings")

    def _provider_calls(self) -> list[tuple[str, str]]:
        """`(file, model-argument)` for every call INTO a model provider."""
        found: list[tuple[str, str]] = []

        for path in SOURCE_ROOT.rglob("*.py"):
            if "generated" in path.parts:
                continue

            tree = ast.parse(path.read_text())

            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                if not isinstance(node.func, ast.Attribute):
                    continue
                if node.func.attr not in {"stream", "generate", "embed_query"}:
                    continue

                receiver = ast.unparse(node.func.value)
                if not any(receiver.endswith(name) for name in self.PROVIDER_RECEIVERS):
                    continue
                # The model is the second positional argument by convention on
                # all three; a keyword form is read too.
                argument = None
                if len(node.args) >= 2:
                    argument = ast.unparse(node.args[1])
                for keyword in node.keywords:
                    if keyword.arg == "model":
                        argument = ast.unparse(keyword.value)

                if argument is not None:
                    found.append((path.name, argument))

        return found

    def test_the_scan_finds_the_call_sites_it_is_meant_to(self):
        # A scan that found nothing would make the assertion below vacuous —
        # which is exactly how this kind of guard rots.
        assert len(self._provider_calls()) >= 4

    def test_every_provider_call_is_handed_a_SETTINGS_field(self):
        offenders = [
            (file, argument)
            for file, argument in self._provider_calls()
            if argument not in self.ALLOWED
        ]

        assert offenders == [], (
            "these calls pass a model that did not come from settings_for(): "
            f"{offenders}"
        )

    def test_no_module_reads_a_model_from_the_ENVIRONMENT(self):
        # The subtlest bypass, and the one the lint cannot see: a model name
        # that never appears in the source because it arrives from a variable.
        # It would work in every environment where the variable happens to be
        # set correctly, and silently downgrade a tenant everywhere else.
        # **`*_MODEL_PATH` is exempt, and the distinction is the whole rule.**
        # What this forbids is resolving a MODEL NAME — which tenant is on
        # which tier — outside `settings_for()`. A path to a local ONNX file on
        # disk is not that: it names no tier, varies per deployment rather than
        # per tenant, and 33-doc §7 puts it in `Config` deliberately, because a
        # tenant-resolved kill switch is one a tenant can switch off.
        pattern = re.compile(
            r"environ(?:\.get)?\s*[\[(]\s*['\"]([^'\"]*MODEL[^'\"]*)['\"]"
        )

        for path in SOURCE_ROOT.rglob("*.py"):
            if "generated" in path.parts:
                continue

            offenders = [
                name
                for name in pattern.findall(path.read_text())
                if not name.endswith("_PATH")
            ]

            assert not offenders, (
                f"{path.name} reads {offenders} from the environment; "
                "resolve it through settings_for() instead"
            )
