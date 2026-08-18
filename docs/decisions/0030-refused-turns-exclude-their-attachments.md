# 0030 — A refused turn's attachments are excluded per turn, not per file

**Status:** accepted · **Code:** `newestUserMessageId(ticketId, { excludingRefused })`

## Decision

Exclusion is per *message*. A file that arrived with a refused turn is untrusted **by association**, not on its own evidence.

## Why

- What was refused is a message. Per-file marking would require evidence about the file that does not exist.
- The same file re-sent on a clean turn works, which is the behaviour to want.

## Consequences

- **`Draft` falls back to an earlier message; `Classify` must not.** The intent is named at each call site through the `excludingRefused` parameter rather than inferred — an unparameterised shared method would have let the two callers agree to be wrong in opposite directions, and the symptom (a refused question quietly staying in context) is invisible.
- **This distinction was found by sabotage, not by design.** The exclusion clause was added to `forEarliestMessage` first; a sabotage pass showed it did not bite. It is now a test rather than an accident.
- **Blindness is accepted.** `Classify` is agent-triggered, so a message usually exists by the time anyone clicks; when it does not, re-running is one click. `forEarliestMessage` returns empty rather than erroring.
