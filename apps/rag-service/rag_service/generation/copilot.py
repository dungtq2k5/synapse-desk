"""The co-pilot's non-drafting surfaces — 13-doc §4.2.

Summary, classification and suggestions. None of them stream: an agent absorbs
the latency, which is the same trade the review loop makes.

**The at-cap behaviour is deliberately NOT uniform** (RDM §1.14). Draft,
classify, suggestions and a MANUAL summary all refuse at the cap. An
ESCALATION-triggered summary runs inside a 10% grace — because at the cap
deflection stops, so ticket volume spikes 3-5x, and without that exemption every
one of those tickets reaches an agent with no context. It is the cheapest call
the system makes and it is worth most exactly when the queue floods. Bounded,
because an unbounded exemption is not a cap.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass

from rag_service.enums import AiGenerationPurpose
from rag_service.generation.boundary import (
    attachment_instruction,
    classified_text_instruction,
    history_instruction,
    new_nonce,
    wrap_attachments,
    wrap_history,
    wrap_question,
)
from rag_service.generation.parts import Attachment, Prompt
from rag_service.ledger.client import GenerationEntry
from rag_service.ledger.metered import LedgerRecorder, QuotaCharger
from rag_service.retrieval.service import BudgetState
from rag_service.settings import AiSettings

logger = logging.getLogger(__name__)

SUMMARY_MAX_TOKENS = 512
CLASSIFY_MAX_TOKENS = 128
SUGGESTIONS_MAX_TOKENS = 768


@dataclass(frozen=True)
class Summary:
    summary_text: str
    suggested_action: str
    confidence_score: float
    model_name: str
    generation_id: str


@dataclass(frozen=True)
class Classification:
    suggested_department_id: str
    suggested_priority: str
    confidence_score: float
    generation_id: str


@dataclass(frozen=True)
class Suggestion:
    title: str
    body: str
    confidence_score: float


#: The priorities a classification may return.
#:
#: Constrained to the domain's own set rather than left to the model, and
#: validated on the way out: a suggested priority of "URGENT!!" is not a
#: priority, and a caller that stored it would produce a ticket no filter
#: matches and no dashboard counts.
VALID_PRIORITIES = ("LOW", "MEDIUM", "HIGH", "URGENT")


class CopilotService:
    def __init__(
        self, generator, ledger: LedgerRecorder, quota: QuotaCharger
    ) -> None:
        self._generator = generator
        self._ledger = ledger
        self._quota = quota

    async def summarize(
        self,
        ticket_id: str,
        transcript: str,
        settings: AiSettings,
        *,
        budget: BudgetState,
        triggered_by_escalation: bool,
        user_id: str | None = None,
    ) -> Summary:
        """A summary plus the ONE action it suggests.

        Both, because a summary an agent still has to read in full has saved
        them nothing — the value is in "here is what happened, do this next",
        and the second half is what makes the first worth generating.
        """
        # **Wrapped, not guarded** — 33-doc §4.2, §8.
        #
        # These two prompts read a ticket transcript, and `ticket_messages` now
        # carries inbound email from senders who never authenticated. The
        # boundary is what stops a message body forging a turn or a new
        # instruction; a REFUSAL here would be the wrong remedy, because it
        # would withhold an agent's summary because a customer wrote oddly —
        # and the customer would never know.
        #
        # The transcript arrives already joined from ticket-service, so only the
        # block can be delimited. `wrap_turns` is the stronger form and is used
        # where the turns are still structured.
        nonce = new_nonce()
        prompt = (
            "Summarise this support conversation for an agent picking it up "
            "cold.\n"
            "Reply as JSON with keys: summary (2-3 sentences), action (one "
            "sentence naming the single next step), confidence (0-1).\n"
            + history_instruction(nonce)
            + "\n"
            + wrap_history(transcript, nonce)
            + "\n\nJSON:"
        )

        text, generation_id = await self._spend(
            prompt,
            settings.generation_model,
            SUMMARY_MAX_TOKENS,
            budget=budget,
            # SUMMARY either way. The escalation trigger decides the GATE
            # (a 10% grace at the cap), not the purpose — `ai_generations`
            # records what a call was FOR, and both are summaries. A separate
            # purpose here would split one line item across two buckets in
            # every report grouped by purpose.
            purpose=AiGenerationPurpose.SUMMARY,
            user_id=user_id,
            ticket_id=ticket_id,
            store_content=True,
        )

        parsed = _json_object(text)

        return Summary(
            summary_text=str(parsed.get("summary") or "").strip(),
            suggested_action=str(parsed.get("action") or "").strip(),
            confidence_score=_confidence(parsed.get("confidence")),
            model_name=settings.generation_model,
            generation_id=generation_id,
        )

    async def classify(
        self,
        ticket_id: str,
        title: str,
        body: str,
        departments: list[tuple[str, str]],
        settings: AiSettings,
        *,
        budget: BudgetState,
        user_id: str | None = None,
        attachments: list[Attachment] | None = None,
    ) -> Classification:
        """Routes a ticket, choosing only from departments that EXIST.

        The candidate list is supplied by the caller because this service
        cannot see `postgres_auth`. A suggestion naming a department that does
        not exist is worse than no suggestion: it either fails a write or
        silently routes a ticket nowhere.

        **The attachments are the ticket's EARLIEST message's** — the third
        selection rule, beside `Chat`'s "the current message's" and `Draft`'s
        "the last user message's". This surface never reads the conversation,
        so nothing carries terms forward to it: a ticket whose body says *"see
        attached"* routes on those two words unless the file is here.

        **Empty is the normal case for an emailed ticket**, which has no message
        at all until somebody replies. Accepted blindness rather than a wait —
        classify is agent-triggered and re-running it is one click.
        """
        parts = attachments or []
        options = "\n".join(f"- {name} (id: {did})" for did, name in departments)
        nonce = new_nonce()

        # **The boundary, which this prompt did not have.** `summarize` and
        # `suggest` both wrap their untrusted text; classify interpolated
        # `TITLE:` and `BODY:` as plain-text delimiters — the exact pattern
        # 33-doc §4 exists to remove, and a body containing its own `BODY:` line
        # could restate the task.
        #
        # It mattered less while this surface was unguarded AND text-only: the
        # blast radius is a misrouted ticket. It matters more now, because the
        # input is a file chosen by whoever opened the ticket — and after 31/32
        # that can be an unauthenticated email sender.
        text_prompt = (
            "Route this support ticket.\n"
            f"Choose ONE department id from this list, and nothing else:\n{options}\n"
            f"Choose ONE priority from: {', '.join(VALID_PRIORITIES)}.\n"
            "Reply as JSON with keys: department_id, priority, confidence (0-1).\n"
            + classified_text_instruction(nonce)
            + (attachment_instruction(nonce) if parts else "")
            + "\n"
            + wrap_question(f"TITLE: {title}\nBODY: {body}", nonce)
            + (
                f"\n{wrap_attachments([part.file_name for part in parts], nonce)}"
                if parts
                else ""
            )
            + "\n\nJSON:"
        )

        # Parts last, after the instruction and the boundary — the same ordering
        # every other multimodal call in this service uses.
        prompt: Prompt = [text_prompt, *parts] if parts else text_prompt

        text, generation_id = await self._spend(
            prompt,
            settings.cheap_model,
            CLASSIFY_MAX_TOKENS,
            budget=budget,
            purpose=AiGenerationPurpose.CLASSIFY,
            user_id=user_id,
            ticket_id=ticket_id,
        )

        parsed = _json_object(text)
        known = {did for did, _ in departments}
        suggested = str(parsed.get("department_id") or "").strip()
        priority = str(parsed.get("priority") or "").strip().upper()

        return Classification(
            # An id the model invented is DROPPED rather than passed on. The
            # caller sees an empty suggestion and leaves the ticket unrouted,
            # which is the honest outcome — routing it somewhere plausible
            # would be worse than routing it nowhere.
            suggested_department_id=suggested if suggested in known else "",
            suggested_priority=priority if priority in VALID_PRIORITIES else "",
            confidence_score=_confidence(parsed.get("confidence")),
            generation_id=generation_id,
        )

    async def suggest(
        self,
        ticket_id: str,
        transcript: str,
        settings: AiSettings,
        *,
        budget: BudgetState,
        user_id: str | None = None,
    ) -> tuple[list[Suggestion], str]:
        """Next-step suggestions for an agent, as a short list."""
        nonce = new_nonce()
        prompt = (
            "Suggest up to three next steps for the agent handling this "
            "conversation.\n"
            "Reply as a JSON array; each item has keys: title, body, "
            "confidence (0-1).\n"
            + history_instruction(nonce)
            + "\n"
            + wrap_history(transcript, nonce)
            + "\n\nJSON:"
        )

        text, generation_id = await self._spend(
            prompt,
            settings.cheap_model,
            SUGGESTIONS_MAX_TOKENS,
            budget=budget,
            purpose=AiGenerationPurpose.SUGGESTIONS,
            user_id=user_id,
            ticket_id=ticket_id,
        )

        return (
            [
                Suggestion(
                    title=str(item.get("title") or "").strip(),
                    body=str(item.get("body") or "").strip(),
                    confidence_score=_confidence(item.get("confidence")),
                )
                for item in _json_array(text)
                if isinstance(item, dict) and item.get("title")
            ][:3],
            generation_id,
        )

    async def _spend(
        self,
        prompt: Prompt,
        model: str,
        max_output_tokens: int,
        *,
        budget: BudgetState,
        purpose: str,
        user_id: str | None,
        ticket_id: str | None,
        store_content: bool = False,
    ) -> tuple[str, str]:
        """Generate, CHARGE, RECORD — the same order as every other spend.

        The charge is awaited because it is the only thing standing between a
        burst of concurrent requests and all of them passing a stale gate; the
        row is fire-and-forget because the money is already gone by the time it
        runs.
        """
        from rag_service.pricing import estimate_cost_micros

        started_at = time.monotonic()
        parts: list[str] = []
        prompt_tokens = 0
        completion_tokens = 0

        async for delta in self._generator.stream(prompt, model, max_output_tokens):
            if delta.text:
                parts.append(delta.text)
            if delta.done:
                prompt_tokens = delta.prompt_tokens
                completion_tokens = delta.completion_tokens

        content = "".join(parts)

        await self._quota.charge(
            budget.organization_id,
            budget.cycle_start,
            estimate_cost_micros(model, prompt_tokens, completion_tokens),
        )

        task = self._ledger.record(
            GenerationEntry(
                organization_id=budget.organization_id,
                user_id=user_id,
                ticket_id=ticket_id,
                purpose=purpose,
                model_name=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                latency_ms=int((time.monotonic() - started_at) * 1000),
                content=content if store_content else None,
            )
        )

        import asyncio

        try:
            generation_id = (
                await asyncio.wait_for(asyncio.shield(task), timeout=2.0) or ""
            )
        except Exception:
            # `Exception` alone: since 3.11 `asyncio.TimeoutError` IS the
            # builtin `TimeoutError` (TimeoutError -> OSError -> Exception), so
            # naming both said nothing the second entry did not already cover.
            #
            # A missing id costs traceability for one call, not the call.
            generation_id = ""

        return content, generation_id


def _json_object(text: str) -> dict:
    """The first JSON object in the text, or an empty one.

    Models wrap JSON in prose and fences no matter how the prompt is worded, so
    the response is SEARCHED rather than parsed whole. Returning `{}` on a
    failure rather than raising means a malformed summary is an empty summary —
    which the caller can render as "not available" — instead of a 500 on a
    request that already cost money.
    """
    return _first_parsable(text, "{", "}", dict)


def _json_array(text: str) -> list:
    return _first_parsable(text, "[", "]", list)


def _first_parsable(text: str, opening: str, closing: str, kind: type):
    r"""The first BALANCED span that parses — 17-doc §1.2 Gap 1.

    The previous implementation was `re.search(r"\{.*\}", text, re.DOTALL)`,
    which with a greedy `.*` spans from the FIRST opening brace to the LAST one
    in the whole response. One object: correct. Prose containing a brace before
    the JSON, or a model that emits an example object followed by the real one,
    and the captured span is not valid JSON — so `json.loads` fails, the caller
    gets `{}`, and a perfectly good object sitting inside the text is reported
    to the user as "summary not available".

    Degraded but safe, and completely undiagnosable: nothing in the logs says a
    parseable object was there.

    So: walk the text, and for each opening delimiter take the span that CLOSES
    it, tracking string literals so a brace inside a quoted value does not
    unbalance the count. First span that parses to the right type wins.

    Still returns an empty value rather than raising — the rule in
    `development-conventions.md` §8.5 is unchanged, and this only widens what
    counts as a successful parse.
    """
    source = text or ""
    empty = kind()

    for start, character in enumerate(source):
        if character != opening:
            continue

        span = _balanced_span(source, start, opening, closing)
        if span is None:
            # Unclosed — the truncated-mid-object case. A later opening
            # delimiter cannot close either, but the loop is cheap and a
            # `break` here would be wrong for `[{...}` where the object closes
            # and the array does not.
            continue

        try:
            parsed = json.loads(span)
        except ValueError:
            continue

        if isinstance(parsed, kind):
            return parsed

    return empty


def _balanced_span(source: str, start: int, opening: str, closing: str) -> str | None:
    """The substring from `start` to its matching delimiter, or None.

    String-aware, because a brace inside a quoted value is not structure —
    `{"detail": "use {braces} carefully"}` counts to zero at the wrong place
    without this, and the resulting span is a parse failure on valid JSON.
    """
    depth = 0
    in_string = False
    escaped = False

    for index in range(start, len(source)):
        character = source[index]

        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue

        if character == '"':
            in_string = True
        elif character == opening:
            depth += 1
        elif character == closing:
            depth -= 1
            if depth == 0:
                return source[start : index + 1]

    return None


def _confidence(raw: object) -> float:
    """A confidence in [0, 1], defaulting to 0 rather than to 1.

    Zero on an unparseable value, deliberately: a UI that hides low-confidence
    suggestions must hide the ones whose confidence could not be read, and
    defaulting to 1 would promote exactly the malformed responses.
    """
    try:
        value = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0

    return min(1.0, max(0.0, value))
