"""The ledger's enumerated values, DERIVED FROM THE PROTO — 13-doc §1.1.

These values exist in TypeScript and in Python, and the doc names the failure
precisely: *"a hand-copied `GREETING_CLASSIFY` that becomes
`GREETING_CLASSIFICATION` on one side meters into a purpose nothing queries."*
Nothing errors when that happens. Rows are written, the counter increments, and
every dashboard grouped by purpose simply omits them.

The members are DECLARED here and the proto is still authoritative — the
agreement is enforced by `test_every_proto_purpose_has_a_python_member`, which
compares these against the generated descriptor and fails the build on any
divergence in either direction.

They were previously built functionally, `StrEnum("AiGenerationPurpose",
_members(...))`, so that adding a purpose to the proto added it here for free.
That saved a one-line edit and cost every static guarantee: no checker can see
the members of a runtime-computed enum, so `AiGenerationPurpose.CLASSIFY` and
`AiGenerationPurpose.CLASIFY` were equally unknown, and the typo became an
`AttributeError` at whatever hour that branch first ran. The drift the dynamic
form prevented was never prevented by it — the test was already doing that job,
and still is.

This also matches how the TypeScript side declares the same values: written
out, guarded by a test. One less asymmetry between the two halves.

The stored VALUE is the bare name — `CHAT_ANSWER`, not
`AI_GENERATION_PURPOSE_CHAT_ANSWER` — because `ai_generations.purpose` is a
`VARCHAR` shared with TypeScript, whose enum uses the bare form. The prefix is
protobuf's requirement that enum value names be unique within a package, not
part of the domain vocabulary.
"""

from __future__ import annotations

from enum import StrEnum

#: `UNSPECIFIED` is absent from both enums below, deliberately. proto3 requires
#: a zero value and it means "the field was not set", which is not a purpose
#: anything could have been spent on — offering it would let a caller write a
#: row describing nothing. `test_UNSPECIFIED_is_NOT_a_usable_member` pins that.


class AiGenerationPurpose(StrEnum):
    """What a generation was FOR. Mirrors `@synapsedesk/common`, via the proto."""

    CHAT_ANSWER = "CHAT_ANSWER"
    DRAFT = "DRAFT"
    SUMMARY = "SUMMARY"
    CLASSIFY = "CLASSIFY"
    SUGGESTIONS = "SUGGESTIONS"
    GREETING_CLASSIFY = "GREETING_CLASSIFY"
    REFORMULATION = "REFORMULATION"
    EMBEDDING = "EMBEDDING"
    REVIEW = "REVIEW"
    INJECTION_CLASSIFY = "INJECTION_CLASSIFY"


class AiGenerationStatus(StrEnum):
    """How it ended.

    A FAILED call still consumed prompt tokens; a CANCELLED stream still spent
    money on the tokens it produced.
    """

    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


#: Every purpose, for the round-trip test and for exhaustiveness checks.
ALL_PURPOSES: tuple[str, ...] = tuple(member.value for member in AiGenerationPurpose)
ALL_STATUSES: tuple[str, ...] = tuple(member.value for member in AiGenerationStatus)
