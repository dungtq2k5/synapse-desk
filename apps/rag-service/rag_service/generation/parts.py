"""What a prompt can be made of — 36-doc §5.1.

**One widened type at the bottom, not a second method alongside the first.**
Every generation call in this service took a `str`, and making one of them
multimodal could have been a parallel `generate_multimodal()`. That doubles the
surface the ledger and the injection guard have to cover, and the two drift the
first time somebody fixes a bug in one.

So `Prompt` is `str | list[str | Attachment]`, and a bare `str` normalises to a
single text part at the provider boundary. Every existing caller and every
existing test fake stays valid, and the only file that knows what a part turns
into is the provider adapter.

**Provider-agnostic on purpose.** Nothing here imports `google.genai`:
`gemini.py` converts, so a second provider is a second adapter rather than a
second prompt type.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Attachment:
    """One file the user attached, already filtered and capped by the caller.

    **The bytes are here rather than an object path** because rag-service has no
    storage client — 35-doc §7. Giving it one would add a peer, a credential and
    a failure mode to the query path, and what makes inline bytes safe is a cap
    that has to exist anyway.

    `file_name` is for the boundary label and for logs. **Never the contents** —
    the same rule `error_log` and `DocumentFlag.detail` follow, and the reason
    is the same: this is attacker-controlled text going somewhere an operator
    reads.
    """

    mime_type: str
    data: bytes
    file_name: str


#: What any generation call accepts.
#:
#: `str` stays in the union rather than being replaced by `[text]`, because
#: replacing it would mean editing every call site and every fake in the suite
#: to say the same thing in more words.
Prompt = str | list[str | Attachment]


def prompt_text(prompt: Prompt) -> str:
    """The text of a prompt, ignoring attachments.

    For assertions and logs. A test that wants to know whether the boundary
    instruction made it into a multimodal prompt should not have to know how
    parts are ordered, and a log line must never contain the bytes.
    """
    if isinstance(prompt, str):
        return prompt

    return "".join(part for part in prompt if isinstance(part, str))


def attachments_of(prompt: Prompt) -> list[Attachment]:
    """The attachment parts, in order. Empty for a plain string."""
    if isinstance(prompt, str):
        return []

    return [part for part in prompt if isinstance(part, Attachment)]
