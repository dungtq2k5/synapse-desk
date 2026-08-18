"""The enum drift guard, made mechanical.

Names this as *"the one genuinely new drift risk"*: these values now
exist in TypeScript and in Python, and a hand-copied `GREETING_CLASSIFY` that
becomes `GREETING_CLASSIFICATION` on one side meters into a purpose nothing
queries. Nothing errors — rows are written, the counter increments, and every
report grouped by purpose quietly omits them.

The Python enums are DERIVED from the proto rather than typed out, so most of
this is a check that the derivation is right. The test that earns its place is
the last one: the TypeScript enum is read from its own source file and compared
against the same proto, which is the only place the two languages are actually
brought face to face.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from rag_service.enums import (
    ALL_PURPOSES,
    ALL_STATUSES,
    AiGenerationPurpose,
    AiGenerationStatus,
)
from rag_service.generated.synapsedesk.ingestion import ledger_pb2

REPO_ROOT = Path(__file__).resolve().parents[3]
TS_ENUM_SOURCE = REPO_ROOT / "libs/common/src/configs/document.config.ts"


def ts_enum_members(name: str) -> set[str]:
    """The members of a TypeScript string enum, read from source.

    Parsed rather than imported, because importing TypeScript from pytest means
    a build step and a Node process for one assertion. The regex is narrow —
    `NAME = 'NAME',` — and a member written any other way simply will not be
    found, which fails the test rather than passing it silently.
    """
    source = TS_ENUM_SOURCE.read_text()
    block = re.search(rf"export enum {name} {{(.*?)^}}", source, re.DOTALL | re.MULTILINE)

    assert block is not None, f"{name} not found in {TS_ENUM_SOURCE}"

    return {
        value
        for _, value in re.findall(r"^\s*(\w+)\s*=\s*'([^']+)',", block.group(1), re.MULTILINE)
    }


class TestDerivedFromTheProto:
    def test_every_proto_purpose_has_a_python_member(self):
        expected = {
            value.name.removeprefix("AI_GENERATION_PURPOSE_")
            for value in ledger_pb2.AiGenerationPurpose.DESCRIPTOR.values
            if not value.name.endswith("UNSPECIFIED")
        }

        assert set(ALL_PURPOSES) == expected

    def test_every_proto_status_has_a_python_member(self):
        expected = {
            value.name.removeprefix("AI_GENERATION_STATUS_")
            for value in ledger_pb2.AiGenerationStatus.DESCRIPTOR.values
            if not value.name.endswith("UNSPECIFIED")
        }

        assert set(ALL_STATUSES) == expected

    def test_UNSPECIFIED_is_NOT_a_usable_member(self):
        # proto3 requires a zero value and it means "the field was not set",
        # which is not a purpose anything could have been spent on. Offering it
        # would let a caller write a row describing nothing.
        assert not any("UNSPECIFIED" in purpose for purpose in ALL_PURPOSES)
        assert not any("UNSPECIFIED" in status for status in ALL_STATUSES)

    def test_the_stored_value_is_the_BARE_name(self):
        # `ai_generations.purpose` is a VARCHAR shared with TypeScript, whose
        # enum uses the bare form. The `AI_GENERATION_PURPOSE_` prefix is
        # protobuf's uniqueness requirement, not domain vocabulary — storing it
        # would make every Python-written row unmatched by every TS query.
        assert AiGenerationPurpose.CHAT_ANSWER.value == "CHAT_ANSWER"
        assert AiGenerationStatus.CANCELLED.value == "CANCELLED"

    def test_a_member_compares_equal_to_its_string(self):
        # `StrEnum`, so a value can be passed straight into a proto string
        # field and compared against a row read back from Postgres without
        # anyone remembering to call `.value`.
        assert AiGenerationPurpose.DRAFT == "DRAFT"
        assert f"{AiGenerationPurpose.REVIEW}" == "REVIEW"


class TestCrossLanguageAgreement:
    """The assertion that actually catches drift."""

    @pytest.mark.parametrize(
        ("python_values", "ts_enum"),
        [
            (ALL_PURPOSES, "AiGenerationPurpose"),
            (ALL_STATUSES, "AiGenerationStatus"),
        ],
    )
    def test_the_TypeScript_enum_matches_value_for_value(self, python_values, ts_enum):
        # Both sides are compared against each other rather than each against
        # the proto separately: two independent checks can both pass while the
        # two languages disagree, if the proto is edited and only one side is
        # regenerated.
        assert set(python_values) == ts_enum_members(ts_enum)

    def test_every_purpose_this_service_WRITES_is_a_known_member(self):
        # The specific bug this file was added after: the co-pilot wrote
        # "CLASSIFICATION", "SUGGESTION" and "ESCALATION_SUMMARY" — three
        # purposes that exist in neither enum, so three kinds of spend that
        # every report grouped by purpose silently omitted.
        written = _purposes_written_by_this_service()

        assert written, "no purposes found — the scan is broken, not the code"
        assert written <= set(ALL_PURPOSES)


def _purposes_written_by_this_service() -> set[str]:
    """Every `AiGenerationPurpose.X` referenced under `rag_service/`.

    A source scan rather than a runtime check, because the wrong-value bug it
    guards against is on a path that only runs when a specific RPC is called —
    and a test that had to call every RPC to find it would miss the next one
    added.
    """
    source_root = REPO_ROOT / "apps/rag-service/rag_service"
    found: set[str] = set()

    for path in source_root.rglob("*.py"):
        # `generated/` is protobuf output, and `enums.py` is the DECLARATION —
        # it references the descriptor, not a purpose being written. Scanning
        # either would report the enum machinery as a call site.
        if "generated" in path.parts or path.name == "enums.py":
            continue
        found.update(re.findall(r"AiGenerationPurpose\.([A-Z_]+)", path.read_text()))

    return found
