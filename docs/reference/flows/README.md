# Flows — what happens, end to end

Six documents, one per path through the system. Each answers the same four
questions: **what triggers it, which components join in, how they interact, and
what it does when something goes wrong.**

## Find the flow by what you are asking

| You are asking | Read |
| :---- | :---- |
| *A customer replied by email and no ticket appeared* | [inbound-email](./inbound-email.md) |
| *Replies keep opening new tickets instead of threading* | [inbound-email](./inbound-email.md) §3 — three holders of one secret |
| *An answer cited the wrong document, or none* | [rag-answering](./rag-answering.md) §5 — the tenant boundary |
| *Answers got vaguer after a deploy* | [rag-answering](./rag-answering.md) §8 — the reranker row |
| *Why was my question refused?* | [rag-answering](./rag-answering.md) §3–§4 — the cap, then the injection layers |
| *I uploaded a PDF and nothing is searchable* | [file-processing](./file-processing.md) |
| *A document is `COMPLETED` but flagged* | [file-processing](./file-processing.md) §4 — pages that were images |
| *Why can't I move this ticket to that status?* | [ticket-lifecycle](./ticket-lifecycle.md) §2 — the edges absent on purpose |
| *A ticket has two assignees* | [ticket-lifecycle](./ticket-lifecycle.md) §3 |
| *Someone did not get notified* | [notification-delivery](./notification-delivery.md) |
| *A user stopped receiving push* | [notification-delivery](./notification-delivery.md) §5 — the two ways a token dies |
| *The dashboard is stale, or a block is missing* | [analytics](./analytics.md) §4 — `dataThrough` vs `computedAt` vs `unavailable` |
| *An export disagrees with the dashboard* | [analytics](./analytics.md) §5 |

## Find the flow from an endpoint

Many routes enter one flow. Swagger documents what each endpoint **accepts and
returns**; these documents describe what **happens** afterwards.

| Route prefix | Flow |
| :---- | :---- |
| `POST /webhooks/email/*` | [inbound-email](./inbound-email.md) |
| `/tickets`, `/tickets/:id/messages` | [ticket-lifecycle](./ticket-lifecycle.md) |
| `/tickets/:id/ai`, `/chat`, `/knowledge` | [rag-answering](./rag-answering.md) |
| `/documents`, `/ingestion-jobs`, `/attachments` | [file-processing](./file-processing.md) |
| `/notifications`, `/webhook-endpoints` | [notification-delivery](./notification-delivery.md) |
| `/analytics` | [analytics](./analytics.md) |

## What is not here

**Per-endpoint documentation.** Swagger generates it from the code and cannot go
stale; a hand-written copy would be stale on arrival. The unit here is the flow,
which many endpoints share.

**Cross-service comparisons.** [`../sys-flows.md`](../sys-flows.md) holds the
ownership map, the entitlement layers and the seven-surface AI matrix. Read it
*before* a flow when the question is "which service owns this" — these documents
are verticals through one path, that one is the horizontal across many.

**Decisions.** A flow says what happens; [`../../decisions/`](../../decisions/)
says why it was chosen and is append-only. Each flow links the ADRs that govern
it.

## Conventions these documents follow

- **Symbols, never line numbers.** `tenant_scope()`, `rerank.py`,
  `ScopeWriterService` — a line number rots on the next edit and a symbol
  survives a refactor that keeps the name.
- **Structural claims over numeric ones.** *"clamped to `MAX_PAGE_SIZE`"*
  survives a constant change; *"clamped to 100"* does not.
- **Mermaid, chosen per job.** Sequence for a path across services, state for a
  lifecycle, flowchart for a pipeline with branches. A sequence diagram of a
  state machine is unreadable, and vice versa.
- **Cross-references are prose, never anchors.** *"see §4"*, not `#section-4`.
  Section numbers move under a rewrite — `rag-answering.md` went from 268 lines
  to 341 without breaking a single inbound link — and a broken anchor fails
  silently, scrolling to the top of the right page. The same instinct as
  "symbols, never line numbers", applied to these documents themselves.
- **Every flow ends with two tables** — edge cases, and symptom → where to look.
  The second one is the most falsifiable part of each document, which is exactly
  why it is worth writing down.
- **Follow the failing path, not the happy one.** Three corrections in review
  were frequencies read off the success case: a lazy initializer *looks*
  memoised because on success it is; a boot-time check *looks* once-per-process
  because on success it is; a 401 branch *looks* like it stops because that is
  what its comment says. Nobody opens a flow document when things are working.
