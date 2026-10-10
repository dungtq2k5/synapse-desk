"""The ledger's enumerated values, derived from the proto.

These values exist in TypeScript and in Python, and a hand-copied
`GREETING_CLASSIFY` that becomes `GREETING_CLASSIFICATION` on one side meters
into a purpose nothing queries. Nothing errors: rows are written, the counter
increments, and every dashboard grouped by purpose simply omits them.

The members are DECLARED here and the proto stays authoritative — the agreement
is enforced by `test_every_proto_purpose_has_a_python_member`, which compares
these against the generated descriptor and fails on divergence in either
direction.

Written out rather than computed at runtime: no checker can see the members of a
dynamically built enum, so `AiGenerationPurpose.CLASIFY` would be an
`AttributeError` at whatever hour that branch first ran. The TypeScript side
declares the same values the same way.

The stored VALUE is the bare name — `CHAT_ANSWER`, not
`AI_GENERATION_PURPOSE_CHAT_ANSWER` — because `ai_generations.purpose` is a
`VARCHAR` shared with TypeScript. The prefix is protobuf's uniqueness
requirement, not part of the domain vocabulary.
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
