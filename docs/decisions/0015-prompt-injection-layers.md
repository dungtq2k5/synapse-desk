# 0015 — Direct prompt injection: regex, a cheap LLM, and a nonce boundary

**Status:** accepted · **Code:** `apps/rag-service/`

## Decision

Three layers. Layer A is a multilingual regex pass. Layer B is a cheap-tier LLM check fused into greeting Layer 2. Layer C is a per-request **nonce** delimiting the source block in the prompt.

## Why

- **The local ONNX classifier was measured and does not work here.** It was removed rather than left dormant — a disabled code path with a 1.4 GB conditional build stage is maintenance surface for a defence measurement says cannot serve this corpus.
- **The two obvious replacements fail the same way.** `llm-guard`'s `PromptInjection` scanner defaults to the same weights just rejected, with the same `en` tag and the same false refusals, behind a library that pulls in a large transformer stack.
- **Layer A must be multilingual.** The one confirmed prompt defect ever found in this system was an English-only assumption in a system multilingual by design.

## Consequences

- **Delimiter forgery is deliberately not a refusal pattern.** Once the boundary is a nonce, a literal `SOURCES:` in a question is inert — and users legitimately paste document excerpts, error logs and prior email threads into a question. Log it as a near-miss and let it through.
- A refusal needs its own proto status; `GREETING` is actively wrong for it.
- A refusal says nothing about what triggered it.
- **Out of scope, decided rather than overlooked:** indirect injection (poisoned documents) and query-length caps. Query length is cost control, not a security control.
