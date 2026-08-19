# Cross-service flows

The flows no single service can show you. Anything visible inside one schema is in [`erd/`](./erd/) and generated; anything visible inside one endpoint is in Swagger. What is left is here.

---

## 1. The ownership map

Four Prisma schemas, no foreign keys between them. Prisma cannot express a relation across schemas and the cross-service edges are absent from every schema deliberately — see [ADR 0022](../decisions/0022-no-cross-service-fks.md). The edges below are therefore **id columns validated at write time over gRPC**, not constraints. Nothing in the database enforces them.

```mermaid
graph LR
  subgraph auth["auth-service"]
    A[(Organization<br/>User · Role<br/>Department)]
  end
  subgraph ticket["ticket-service"]
    T[(Ticket · TicketMessage<br/>MessageAttachment<br/>AiSummary · AuditLog)]
  end
  subgraph ingestion["ingestion-service"]
    I[(Document · Chunk<br/>PendingUpload)]
  end
  subgraph notification["notification-service"]
    N[(Notification<br/>Preference)]
  end
  subgraph external["Not a schema"]
    Q[[Qdrant<br/>documents only]]
    F[[Firebase Storage]]
  end

  T -. "organizationId · senderId<br/>currentDepartmentId" .-> A
  I -. "organizationId · uploadedById" .-> A
  N -. "organizationId · userId" .-> A
  I ==> Q
  T ==> F
  I ==> F

  classDef ext fill:#f6f6f6,stroke:#999,stroke-dasharray:3 3
  class Q,F ext
```

Dashed edges are unenforced references. Solid edges are stores with no schema at all, so nothing there cascades either — a deleted `Document` row leaves its vectors and its object behind unless the deleting code removes them.

**The corpus is documents-only.** No ticket text is ever embedded into Qdrant; `Chunk` rows carry the `document_id` that vectors point back to. A ticket becomes retrievable only by being written up as a knowledge document.

---

## 2. The AI request pipeline

Seven RPCs on `rag-service`. They share one spine, and the useful thing to know is not the spine — it is which stage each surface skips. So the spine is drawn once here, and §3 is the matrix of who takes which branch.

**There is no per-surface diagram, on purpose.** Six near-identical pictures diverging on three nodes each is six things to keep in step; a matrix is one.

```mermaid
flowchart TD
  IN([gRPC request<br/>organizationId · caller context]) --> CAP{Budget:<br/>allows_embedding?}

  CAP -->|no| GRACE{Escalation<br/>grace?}
  GRACE -->|"no · six of seven surfaces"| DENY[["PERMISSION_DENIED<br/>AT_CAP_REFUSAL"]]
  GRACE -->|"yes · Summarize only"| GUARD
  CAP -->|yes| GUARD

  GUARD{Guarded<br/>RPC?} -->|no| RETR
  GUARD -->|yes| LA[Layer A · regex<br/>8 languages, no model]
  LA -->|clean| LB[Layer B · cheap-tier LLM<br/>INJECTION_CLASSIFY]
  LA -->|hit| REFUSE
  LB -->|clean| RETR
  LB -->|hit| REFUSE[[Refusal<br/>write-back — see §5]]

  RETR{Retrieves?} -->|yes| DOCS[Hybrid → hydrate → FlashRank<br/>documents corpus only]
  RETR -->|"no · Summarize, Classify"| ATT
  DOCS -->|"Search stops here"| OUT
  DOCS --> ATT{Attachments<br/>on this surface?}
  ATT -->|yes| PARTS[Eligible parts fetched<br/>after row-level filtering]
  ATT -->|no| PROMPT
  PARTS --> PROMPT[Prompt assembly<br/>every untrusted span<br/>inside a per-request nonce]
  PROMPT --> GEN[Generate · book to the ledger<br/>estimated_cost_micros]
  GEN --> OUT([Response])
```

Five things this spine is load-bearing for:

- **The cap is checked before anything else.** Every one of the seven aborts with `PERMISSION_DENIED` / `AT_CAP_REFUSAL` and does no work first.
- **The grace branch exists once.** `Summarize` is the only surface that can proceed past a spent budget, and only when the caller sets `triggered_by_escalation` — the flag is not the authority, the escalation is.
- **The guard is not on every surface**, and the reasons are recorded per RPC in the code rather than inferred — see §3 and [ADR 0015](../decisions/0015-prompt-injection-layers.md).
- **Attachments reach retrieval, not only generation** — [ADR 0017](../decisions/0017-attachments-reach-retrieval.md). This is why `PARTS` sits before `PROMPT` and not inside it.
- **`Search` leaves before generation.** It is the one surface that returns retrieved chunks and never calls a generation model, which is also why it is the one surface with no nonce boundary — nothing assembles a prompt. The hydrate-before-rerank ordering inside `DOCS` is [ADR 0008](../decisions/0008-hydrate-before-rerank.md).

---

## 3. Where the seven surfaces differ

| | `Search` | `Chat` | `Ask` | `Draft` | `Summarize` | `Classify` | `Suggest` |
| :---- | :--: | :--: | :--: | :--: | :--: | :--: | :--: |
| Cap abort | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Escalation grace | — | — | — | — | **✓** | — | — |
| Injection guard (A+B) | — | ✓ | ✓ | ✓ | — | — | — |
| Greeting detection | — | **✓** | — | — | — | — | — |
| Reformulation | — | ✓ | — | — | — | — | — |
| Retrieval | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| Attachments | — | ✓ | — | ✓ | — | ✓ | — |
| Review + refine | — | — | — | **✓** | — | — | — |
| Nonce boundary | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ledger purpose | `EMBEDDING` | `CHAT_ANSWER` | `CHAT_ANSWER` | `DRAFT` | `SUMMARY` | `CLASSIFY` | `SUGGESTIONS` |

Plus the purposes booked by stages rather than surfaces: `GREETING_CLASSIFY` and `REFORMULATION` inside `Chat`'s preprocessing, `INJECTION_CLASSIFY` inside Layer B, `REVIEW` inside `Draft`'s critique pass, `EMBEDDING` wherever retrieval runs.

### Why four surfaces carry no injection guard

Recorded at the guard itself, not here, so the two cannot drift:

| RPC | Reason |
| :---- | :---- |
| `Summarize` | output is a summary shown to an agent, not shaped by a question |
| `Classify` | output is a department id and a priority — a constrained choice |
| `Suggest` | output is a fixed set of suggested actions |
| `Search` | retrieval only — no model ever sees the query text |

The distinction is **whether an attacker's text can steer a free-form answer to a human**, not whether untrusted text is present. It is present in all seven. That is why the nonce boundary covers six of them while the guard covers three: the boundary is about the model reading a delimiter, the guard is about the answer being weaponisable.

### Draft's extra pass

`Draft` is the only surface that generates twice: a draft, a critique on the **cheap** tier, and a refine on the generation tier when the critique asks for one. The refine books under `DRAFT`, not under a purpose of its own — deliberately, so the text the agent actually sends is attributed to the surface that produced it. Only the critique books `REVIEW`.

### Which attachments each surface sees

Three surfaces take attachments and each selects a different message, because each is answering a different question:

| Surface | Message selected | Refused turns |
| :---- | :---- | :---- |
| `Chat` | the message being sent *(gateway fetches; the rule lives in ticket-service)* | excluded |
| `Draft` | the newest **user** message, skipping AI replies | excluded |
| `Classify` | the **earliest** message on the ticket | **included** |

`Classify` is the deliberate exception: a refused opening message is still the opening message, and routing a ticket is not answering its author. The other two follow [ADR 0030](../decisions/0030-refused-turns-exclude-their-attachments.md) — exclusion is **per turn, not per file**, and it reaches the files and not only the text. A user who sends injection text plus a screenshot has both dropped.

Eligibility is decided from the row — mime type and `fileSizeBytes` — before any download. A caller that fetched first and filtered after would pay for every zip anyone ever attached.

---

## 4. Escalation handoff

The flow that spans the most services: a customer asks, the AI cannot answer, a human picks it up.

```mermaid
sequenceDiagram
  autonumber
  actor C as Customer
  participant G as api-gateway<br/>(WS)
  participant T as ticket-service
  participant R as rag-service
  participant N as notification-service
  actor A as Agent

  C->>G: message (WS)
  G->>T: persist
  T->>R: Chat
  R-->>T: answer · low confidence
  T-->>G: answer + escalation offer
  G-->>C: stream

  C->>G: escalate
  G->>T: escalate
  Note over T: status → ESCALATED<br/>currentDepartmentId set
  T-)R: Summarize (triggered_by_escalation)
  Note right of R: the one call allowed<br/>past a spent budget
  R--)T: AiSummary row
  T-)N: NATS · notify department

  A->>G: opens ticket
  G->>T: read
  T-->>G: transcript + AiSummary
  A->>G: reply (WS)
  G->>T: persist
  T-->>G: broadcast
  G-->>C: agent's reply
```

Two properties worth not rediscovering:

- **The summary is fire-and-forget.** Escalation does not wait for it and does not fail if it fails. The agent may open a ticket that has no summary yet.
- **WebSocket is a transport, not a second write path** ([ADR 0011](../decisions/0011-websocket-is-a-transport.md)) — every arrow into `ticket-service` above is the same write path the REST route uses.

---

## 5. The refusal write-back

What a guard hit actually does, across two services. This is the loop that makes [ADR 0030](../decisions/0030-refused-turns-exclude-their-attachments.md) enforceable rather than aspirational.

```mermaid
flowchart LR
  HIT[Layer A or B hit] --> CANNED[Canned refusal<br/>returned to the caller]
  CANNED --> WB[ticket-service marks<br/>the turn]
  WB --> FLAG[["excludedFromAiContext = true<br/>on the newest user message"]]
  FLAG --> TXT[Three transcript builders<br/>drop its content]
  FLAG --> FILES[Attachment selection<br/>drops its files]
  TXT --> NEXT([Next AI call on this ticket])
  FILES --> NEXT
```

The flag is written on the **message**, which is why one boolean removes both the sentence and the screenshot. The three transcript builders and two of the three attachment selectors read it; `Classify`'s selector deliberately does not (§3).

A refused message is still visible to humans. Unlike an internal note — which is stripped before serialization, [ADR 0023](../decisions/0023-internal-notes-are-stripped-before-serialization.md) — a refusal is the customer's own text and hiding it from them would be a different product decision than the one that was made. The exclusion is from the **model's** context only.
