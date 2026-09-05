# Flows — what happens, end to end

Six documents, one per path through the system. Each answers the same four
questions: **what triggers it, which components join in, how they interact, and
what it does when something goes wrong.**

## Find the flow by what you are asking

| You are asking                                          | Read                                                                               |
| :------------------------------------------------------ | :--------------------------------------------------------------------------------- |
| _A customer replied by email and no ticket appeared_    | [inbound-email](./inbound-email.md)                                                |
| _Replies keep opening new tickets instead of threading_ | [inbound-email](./inbound-email.md) §3 — three holders of one secret               |
| _An answer cited the wrong document, or none_           | [rag-answering](./rag-answering.md) §5 — the tenant boundary                       |
| _Answers got vaguer after a deploy_                     | [rag-answering](./rag-answering.md) §8 — the reranker row                          |
| _Why was my question refused?_                          | [rag-answering](./rag-answering.md) §3–§4 — the cap, then the injection layers     |
| _I uploaded a PDF and nothing is searchable_            | [file-processing](./file-processing.md)                                            |
| _A document is `COMPLETED` but flagged_                 | [file-processing](./file-processing.md) §4 — pages that were images                |
| _Why can't I move this ticket to that status?_          | [ticket-lifecycle](./ticket-lifecycle.md) §2 — the edges absent on purpose         |
| _A ticket has two assignees_                            | [ticket-lifecycle](./ticket-lifecycle.md) §3                                       |
| _Someone did not get notified_                          | [notification-delivery](./notification-delivery.md)                                |
| _A user stopped receiving push_                         | [notification-delivery](./notification-delivery.md) §5 — the two ways a token dies |
| _The dashboard is stale, or a block is missing_         | [analytics](./analytics.md) §4 — `dataThrough` vs `computedAt` vs `unavailable`    |
| _An export disagrees with the dashboard_                | [analytics](./analytics.md) §5                                                     |

## Find the flow from an endpoint

Many routes enter one flow. Swagger documents what each endpoint **accepts and
returns**; these documents describe what **happens** afterwards.

| Route prefix                                    | Flow                                                |
| :---------------------------------------------- | :-------------------------------------------------- |
| `POST /webhooks/email/*`                        | [inbound-email](./inbound-email.md)                 |
| `/tickets`, `/tickets/:id/messages`             | [ticket-lifecycle](./ticket-lifecycle.md)           |
| `/tickets/:id/ai`, `/chat`, `/knowledge`        | [rag-answering](./rag-answering.md)                 |
| `/documents`, `/ingestion-jobs`, `/attachments` | [file-processing](./file-processing.md)             |
| `/notifications`, `/webhook-endpoints`          | [notification-delivery](./notification-delivery.md) |
| `/analytics`                                    | [analytics](./analytics.md)                         |

## What is not here

**Per-endpoint documentation.** Swagger generates it from the code and cannot go
stale; a hand-written copy would be stale on arrival. The unit here is the flow,
which many endpoints share.

**Cross-service comparisons.** [`../sys-flows.md`](../sys-flows.md) holds the
ownership map, the entitlement layers and the seven-surface AI matrix. Read it
_before_ a flow when the question is "which service owns this" — these documents
are verticals through one path, that one is the horizontal across many.

**Decisions.** A flow says what happens; [`../../decisions/`](../../decisions/)
says why it was chosen and is append-only. Each flow links the ADRs that govern
it.

## Conventions these documents follow

- **Symbols, never line numbers.** `tenant_scope()`, `rerank.py`,
  `ScopeWriterService` — a line number rots on the next edit and a symbol
  survives a refactor that keeps the name.
- **Structural claims over numeric ones.** _"clamped to `MAX_PAGE_SIZE`"_
  survives a constant change; _"clamped to 100"_ does not.
- **Mermaid, chosen per job.** Sequence for a path across services, state for a
  lifecycle, flowchart for a pipeline with branches. A sequence diagram of a
  state machine is unreadable, and vice versa.
- **Cross-references are prose, never anchors.** _"see §4"_, not `#section-4`.
  Section numbers move under a rewrite — `rag-answering.md` went from 268 lines
  to 341 without breaking a single inbound link — and a broken anchor fails
  silently, scrolling to the top of the right page. The same instinct as
  "symbols, never line numbers", applied to these documents themselves.
- **Every flow ends with two tables** — edge cases, and symptom → where to look.
  The second one is the most falsifiable part of each document, which is exactly
  why it is worth writing down.
- **The first two are enforced, not merely stated.**
  `libs/common/src/configs/flow-references.spec.ts` reads every document here
  and fails when a backticked filename or `SCREAMING_SNAKE` constant no longer
  resolves, and when a citation carries a line number. Cite the file, never
  the file with a line appended — the latter is refused rather than checked,
  because nothing can verify it.

  It caught this very paragraph on its first run. The sentence above
  originally demonstrated the rule with a literal line-numbered example,
  which is exactly what test 5 refuses. A guard that reads prose cannot tell
  an illustration from a citation, and the fix was the wording rather than an
  exemption for the one file most likely to describe the rule.

- **Follow the failing path, not the happy one.** Three corrections in review
  were frequencies read off the success case: a lazy initializer _looks_
  memoised because on success it is; a boot-time check _looks_ once-per-process
  because on success it is; a 401 branch _looks_ like it stops because that is
  what its comment says. Nobody opens a flow document when things are working.
