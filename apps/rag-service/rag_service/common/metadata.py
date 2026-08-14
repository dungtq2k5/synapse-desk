"""Unpacking the caller context the gateway packed into gRPC metadata.

The TypeScript half is `packRequestContext` in `libs/grpc-proto`. This is the
one place the two languages meet on a wire format that no compiler checks:
metadata is stringly-typed, so a key spelled differently here does not error —
it yields nothing, and `department_ids` quietly becomes an empty list.

An empty `department_ids` is not a harmless default. It means "this caller is in
no department", which is a *narrower* scope than they actually have, so the
failure mode is a user who suddenly cannot find their own team's documents.
That is the safe direction and it is still a bug; the constants below are what
keeps it from happening at all.
"""

from __future__ import annotations

import json
from typing import Any

from rag_service.common.caller_context import CallerContext

#: Mirrors `GRPC_CHANNEL_OPTIONS` in `libs/grpc-proto/src/constants.ts` — 35-doc §7.1.
#:
#: **The one place in this service where a MISSING value is the bug.** Every
#: TypeScript client and every TypeScript server applies those options, so both
#: ends of a Node-to-Node call agree at 10 MB. `grpc.aio.server()` takes no
#: options, which left this server at gRPC's 4 MB default — an asymmetry that is
#: worse than a low limit shared by everyone: a caller configured for 10 MB
#: sends a request it has every reason to believe is fine and gets
#: RESOURCE_EXHAUSTED from the far end.
#:
#: Nothing hit it before attachments because no request came close. `ChatRequest`
#: now carries file bytes, so the ceiling is load-bearing and its two halves have
#: to be read together.
#:
#: Duplicated across the language boundary for the same reason the quota key and
#: the metadata names above are, and guarded the same way — by a test that pins
#: the numbers against the TypeScript source.
GRPC_MAX_MESSAGE_BYTES = 10 * 1024 * 1024

#: The keepalive halves of the same object, in Python's millisecond spelling.
GRPC_KEEPALIVE_TIME_MS = 30_000
GRPC_KEEPALIVE_TIMEOUT_MS = 10_000

#: The `options` list `grpc.aio.server()` and any Python channel take.
#:
#: Python spells these as dotted strings rather than camelCase keys, which is
#: precisely why the mirror is worth a named constant: `maxReceiveMessageLength`
#: silently does nothing here, and a typo in a string key is accepted and
#: ignored rather than raising.
GRPC_SERVER_OPTIONS: list[tuple[str, int]] = [
    ("grpc.max_receive_message_length", GRPC_MAX_MESSAGE_BYTES),
    ("grpc.max_send_message_length", GRPC_MAX_MESSAGE_BYTES),
    ("grpc.keepalive_time_ms", GRPC_KEEPALIVE_TIME_MS),
    ("grpc.keepalive_timeout_ms", GRPC_KEEPALIVE_TIMEOUT_MS),
]

#: Mirrors `GRPC_CONTEXT_METADATA` in `libs/common/src/configs/app.config.ts`.
#: Duplicated across the language boundary for the same reason the quota key is,
#: and guarded the same way — by a test that pins the exact strings.
CONTEXT_METADATA = {
    "user_id": "user_id",
    "organization_id": "organization_id",
    "is_super_admin": "is_super_admin",
    "department_ids": "department_ids",
    "permission_codes": "permission_codes",
    "is_email_verified": "is_email_verified",
    "ip": "ip_address",
    "user_agent": "user_agent",
}


def unpack_caller_context(metadata: Any) -> CallerContext:
    """Rebuilds the context from an incoming call's metadata.

    Never raises on a missing or malformed field. A context that is absent is a
    context with no tenant, and `require_tenant()` is what refuses the request
    — one refusal point rather than two, so there is no path where a partially
    parsed context proceeds with a partially applied filter.
    """
    values = _as_dict(metadata)

    return CallerContext(
        organization_id=values.get(CONTEXT_METADATA["organization_id"]) or None,
        sub=values.get(CONTEXT_METADATA["user_id"]) or None,
        department_ids=_json_list(values.get(CONTEXT_METADATA["department_ids"])),
        permission_codes=_json_list(values.get(CONTEXT_METADATA["permission_codes"])),
        is_super_admin=values.get(CONTEXT_METADATA["is_super_admin"]) == "true",
    )


def _as_dict(metadata: Any) -> dict[str, str]:
    """gRPC metadata is a sequence of pairs, and may be absent entirely."""
    if not metadata:
        return {}

    pairs = metadata.items() if hasattr(metadata, "items") else metadata

    return {
        key: value.decode() if isinstance(value, bytes) else str(value)
        for key, value in pairs
    }


def _json_list(raw: str | None) -> list[str]:
    """A JSON array of strings, or an empty list.

    Malformed JSON degrades to empty rather than raising. The alternative — a
    500 on a request whose metadata was mangled in transit — tells the user
    nothing and tells the operator less; an empty department list narrows the
    caller's scope, which is the safe direction to fail in.
    """
    if not raw:
        return []

    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []

    if not isinstance(parsed, list):
        return []

    return [entry for entry in parsed if isinstance(entry, str)]
