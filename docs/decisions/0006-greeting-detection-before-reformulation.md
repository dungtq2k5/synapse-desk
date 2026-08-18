# 0006 — Greeting detection runs first, and the reply is canned

**Status:** accepted · **Code:** `apps/rag-service/`

## Decision

Layer 1 (regex, multilingual) runs **before** contextual reformulation. A detected greeting is answered from a canned reply table keyed by the detected language — not by an LLM call.

## Why

- **It is the cheapest deflection available.** Every "thanks!" that reaches retrieval costs an embedding, a Qdrant query, a rerank and a generation, all metered against the tenant. Layer 1 costs a regex match.
- **Ordering is the whole point.** Reformulation before Layer 1 inverts the principle: in any ongoing conversation every "ok got it" would pay for an LLM rewrite before anything checked whether it was a greeting.
- **Paying a model to produce one of about six sentences is spend for nothing.** The canned table is free, instant, and unaffected by the budget cap.

## Consequences

- `AiGenerationPurpose` has no `GREETING_REPLY` value. If canned replies ever prove too rigid, adding the value and ledgering the call is the change — rather than leaving an unmetered LLM call in the flow.
- The greeting regex is multilingual on purpose; an English-only list is a silent cost leak.
- Layer 1 is **skipped when a message carries attachments**. "hi" plus a screenshot of an error is a question whose author did not type it out.
