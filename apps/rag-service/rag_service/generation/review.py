"""Co-RAG's review loop, and the co-pilot's whole differentiator.

Tier 1 chat runs `co_rag_max_retries = 0`: one generation, streamed, because the
product IS the instant answer. The co-pilot runs the SAME generator with 1-2
review passes, because an agent absorbs the latency and gets quality for it.

    draft ──> review ──┬─ COMPLETE ─> done
                       └─ PARTIAL ──> refine ──> review ──> …  (bounded)

**Bounded, and the bound is the point.** An unbounded refine loop is an
unbounded bill: each pass is another generation charged to the tenant, and a
reviewer that never says COMPLETE — because the sources genuinely do not answer
the question — would spend until the cap stopped it. The loop exits on the
retry budget regardless of what the reviewer thinks.

**Every pass is metered.** Three generations for one draft is three ledger rows
and three charges. Counting only the final one was the metering hole RDM Table
29 closes, and it would be at its widest exactly here, where one request makes
the most calls.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from enum import StrEnum

from rag_service.generation.boundary import (
    boundary_instruction,
    new_nonce,
    strip_nonce,
    wrap_question,
    wrap_sources,
)
from rag_service.retrieval.service import HydratedChunk

# Deliberately imports NOTHING from `corag`. This module is prompts, a verdict
# enum and a parser; `corag` is the loop that uses them. One-way is what keeps
# the two importable in either order — the reverse dependency was a circular
# import the moment the loop landed.

logger = logging.getLogger(__name__)


class ReviewVerdict(StrEnum):
    """What the reviewer thought of a draft."""

    COMPLETE = "COMPLETE"
    """Grounded, answers the question, cites its sources. Ship it."""

    PARTIAL = "PARTIAL"
    """Right direction, something missing. Worth one more pass."""

    UNGROUNDED = "UNGROUNDED"
    """Says things the sources do not support — the failure that matters most.

    Not merely "needs work": an ungrounded draft is a confident invention, and
    an agent skim-reading before pressing send is exactly how it reaches a
    customer. It is refined like PARTIAL, and if it survives the retry budget
    the answer is downgraded rather than shipped as if it were grounded.
    """


@dataclass(frozen=True)
class Review:
    verdict: ReviewVerdict
    #: What to fix, fed verbatim into the refine prompt. Empty on COMPLETE.
    critique: str = ""


#: A verdict is one word plus a short critique. Capped so a reviewer that
#: ignores its instructions costs a few tokens rather than a full generation.
REVIEW_MAX_TOKENS = 256

REFINE_MAX_TOKENS = 1_024


def build_review_prompt(
    question: str, draft: str, chunks: list[HydratedChunk]
) -> str:
    """Asks for a verdict and a critique, in that order.

    Verdict FIRST, on its own line: a model asked to reason and then conclude
    buries the conclusion, and parsing prose for a decision is how a reviewer
    silently starts returning COMPLETE for everything.
    """
    sources = "\n\n".join(
        f"[{index + 1}] {chunk.content_text}" for index, chunk in enumerate(chunks)
    )

    nonce = new_nonce()

    return (
        "You are reviewing a support reply drafted from the numbered sources.\n"
        # The SAME boundary as the answer prompt. CoRAG runs this
        # on the Draft path, whose question can be a stranger's email, so
        # hardening only `build_prompt` would leave the forgeable delimiter one
        # call away.
        + boundary_instruction(nonce)
        + "Answer on two lines.\n"
        "Line 1: exactly one of COMPLETE, PARTIAL, UNGROUNDED.\n"
        "  COMPLETE  — answers the question and every claim is supported.\n"
        "  PARTIAL   — supported, but incomplete or unclear.\n"
        "  UNGROUNDED — contains a claim the sources do not support.\n"
        "Line 2: one sentence saying what to fix. Empty if COMPLETE.\n\n"
        f"{wrap_sources(sources, nonce)}\n\n"
        f"{wrap_question(question, nonce)}\n\n"
        f"DRAFT:\n{strip_nonce(draft, nonce)}\n\nREVIEW:"
    )


def build_refine_prompt(
    question: str, draft: str, critique: str, chunks: list[HydratedChunk]
) -> str:
    """Rewrites the draft against the critique, still grounded in the sources.

    The sources are repeated rather than assumed remembered: each pass is an
    independent call with no shared state, so a refine prompt without them is a
    request to improve a text from general knowledge — which is precisely the
    behaviour §1.6 forbids, arriving through the quality mechanism.
    """
    sources = "\n\n".join(
        f"[{index + 1}] {chunk.content_text}" for index, chunk in enumerate(chunks)
    )

    nonce = new_nonce()

    return (
        "Rewrite the support reply to address the reviewer's critique.\n"
        + boundary_instruction(nonce)
        + "Use ONLY the numbered sources. Cite them inline as [1], [2].\n"
        "If the sources do not support a claim, remove it rather than softening "
        "it — a hedged invention is still an invention.\n\n"
        f"{wrap_sources(sources, nonce)}\n\n"
        f"{wrap_question(question, nonce)}\n\n"
        f"CURRENT DRAFT:\n{strip_nonce(draft, nonce)}\n\n"
        f"REVIEWER: {strip_nonce(critique, nonce)}\n\nIMPROVED REPLY:"
    )


def parse_review(text: str) -> Review:
    """Reads the verdict, defaulting to COMPLETE on anything unrecognisable.

    **COMPLETE is the safe default here**, which is the opposite of the usual
    instinct. An unparseable review means the reviewer failed, not that the
    draft is bad — and treating a reviewer failure as PARTIAL would spend
    another generation on every malformed response, turning one flaky model
    into a doubled bill. The draft is still shown to a human before anything
    reaches a customer, which is what makes stopping the cheaper mistake.
    """
    first_line = (text or "").strip().splitlines()
    if not first_line:
        return Review(ReviewVerdict.COMPLETE)

    head = first_line[0].strip().upper()
    critique = first_line[1].strip() if len(first_line) > 1 else ""

    for verdict in (ReviewVerdict.UNGROUNDED, ReviewVerdict.PARTIAL):
        # UNGROUNDED checked first: "PARTIAL" is not a substring of it, but a
        # model writing "PARTIALLY UNGROUNDED" should be read as the worse of
        # the two rather than the one that appears first in the string.
        if re.search(rf"\b{verdict.value}\b", head):
            return Review(verdict, critique)

    return Review(ReviewVerdict.COMPLETE, critique)
