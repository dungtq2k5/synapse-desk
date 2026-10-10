"""The widened prompt type

**One type at the bottom rather than a second method alongside the first.** A
parallel `generate_multimodal()` would double the surface the ledger and the
injection guard each have to cover, and the two would drift the first time
somebody fixed a bug in one of them.
"""

from __future__ import annotations

from rag_service.generation.gemini import _to_contents
from rag_service.generation.parts import (
    Attachment,
    attachments_of,
    prompt_text,
)

SCREENSHOT = Attachment(
    mime_type="image/png", data=b"\x89PNG\r\n", file_name="error.png"
)


def test_a_plain_string_reaches_the_provider_UNCHANGED():
    """**The property that makes the widening invisible.**

    Every text prompt in this service — classification, reformulation, the
    answer, the review pass — is a `str`, and each must produce exactly the
    request it produced before this change. Wrapping it in a one-element list
    would also work and would alter every call in the system to fix the two
    that needed it.
    """
    assert _to_contents("classify this") == "classify this"


def test_an_attachment_becomes_a_provider_part():
    contents = _to_contents(["what is this?", SCREENSHOT])

    assert isinstance(contents, list)
    assert contents[0] == "what is this?"
    # The SDK's own part type, built from bytes and a mime type. Asserted
    # structurally rather than by class name so a provider SDK upgrade that
    # renames it fails on behaviour instead of on spelling.
    assert getattr(contents[1], "inline_data", None) is not None
    assert contents[1].inline_data.mime_type == "image/png"


def test_order_is_preserved():
    """Text before image, or after it, is the caller's decision to make.

    The reformulation prompt puts its instruction first and the file second;
    the boundary wraps parts between two text markers. Neither works if
    this reorders.
    """
    contents = _to_contents(["before", SCREENSHOT, "after"])

    assert contents[0] == "before"
    assert contents[2] == "after"


def test_prompt_text_ignores_the_bytes():
    """What every fake records and every assertion reads.

    Identity on a `str`, so the whole existing suite kept working when the type
    widened — and it is what keeps file bytes out of a recorded call.
    """
    assert prompt_text("just text") == "just text"
    assert prompt_text(["a ", SCREENSHOT, "b"]) == "a b"
    assert SCREENSHOT.data not in prompt_text(["a ", SCREENSHOT]).encode()


def test_attachments_of_reads_them_back_in_order():
    second = Attachment(mime_type="application/pdf", data=b"%PDF", file_name="a.pdf")

    assert attachments_of("no parts here") == []
    assert attachments_of(["q", SCREENSHOT, second]) == [SCREENSHOT, second]
