# Documentation Map

Start here. Every document has exactly one job; this page says which.

## Core — read before your first commit

| Document | Authoritative for |
| :---- | :---- |
| [development-conventions.md](./development-conventions.md) | **How to write the code.** Rules and examples only |
| [product-overview.md](./product-overview.md) | Personas, feature scope, business metrics |
| [tech-stack-spec.md](./tech-stack-spec.md) | Technology choices and justification |
| [rdm-spec.md](./rdm-spec.md) | Tables, columns, constraints, cascade rules |
| [api-endpoints-plan.md](./api-endpoints-plan.md) | Every endpoint, permission, WS event, NATS subject |

## Integrator references — written for someone outside this repo

Not internal specs. Each one is the **contract** a client codes against, and each names the source file that wins if the two disagree.

| Document | Audience | Source of truth it mirrors |
| :---- | :---- | :---- |
| [graphql-api.md](./graphql-api.md) | Front end | `apps/api-gateway/src/schema.gql` (the committed SDL) and the resolvers behind it |
| [websocket-api.md](./websocket-api.md) | Front end | `realtime.config.ts` (events, limits), `realtime.gateway.ts` (handshake) |
| [webhooks.md](./webhooks.md) | Customer integrators | `libs/common/src/contracts/webhook.contract.ts` (payload, signing, every constant) |

**A change to any of those source files is a change to a published contract.** These are the only documents here read by people who cannot see the code, so drift in them is not a stale note — it is a receiver that verifies a signature wrongly, or a client that waits forever for an event that was renamed.

## `decisions/` — why, permanently

Append-only. A decision is never edited; superseding one means writing a new one that links back. Docblocks and comments cite these, because their numbers do not move.

**Start every new ADR from [TEMPLATE.md](./decisions/TEMPLATE.md).** Every file here follows its structure, and `adr-structure.spec.ts` fails the build when one does not:

| Part | Rule |
| :---- | :---- |
| File name | `NNNN-kebab-case-title.md` — the next free four-digit number |
| Line 1 | `# NNNN — Title`, where `NNNN` matches the file name |
| Line 3 | `**Status:**` then `accepted`, or `superseded by [ADR NNNN](./NNNN-….md)` — followed by **exactly one** of `**Code:**` (the files that implement it) or `**Rule:**` (the conventions section it created). Further keys such as `**Follows:**` may come after |
| Sections | `## Decision` first and `## Why` second; `## Consequences` last. Any other `##` section goes between `## Why` and `## Consequences`; `###` subsections are free |

*"Never edited"* means the **decision** is never edited. Bringing a file into this structure, or unlinking a reference that no longer resolves, changes how a decision is presented, not what it decided.

| ADR | Decides |
| :---- | :---- |
| [0001](./decisions/0001-no-prisma-enums.md) | Enumerated columns are `String`, never a Prisma `enum` |
| [0002](./decisions/0002-every-mocked-rpc-needs-an-owner-test.md) | Every mocked RPC needs an owner test |
| [0003](./decisions/0003-bullmq-over-nest-cron.md) | Background jobs run on BullMQ repeats, not `@Cron` |
| [0004](./decisions/0004-mappers-name-the-foreign-side.md) | Mapper names carry the foreign type, and the two directions are asymmetric |
| [0005](./decisions/0005-meter-cost-not-tokens.md) | Meter `estimated_cost_micros`, never raw tokens |
| [0006](./decisions/0006-greeting-detection-before-reformulation.md) | Greeting detection runs first, and the reply is canned |
| [0007](./decisions/0007-settings-layer-owns-model-names.md) | A model name may appear in exactly one place |
| [0008](./decisions/0008-hydrate-before-rerank.md) | Hydrate the candidate pool before reranking |
| [0009](./decisions/0009-rollups-are-plain-tables.md) | Analytics rollups are plain tables written by idempotent jobs |
| [0010](./decisions/0010-readiness-probes-do-not-cascade.md) | A readiness probe never gates on a peer |
| [0011](./decisions/0011-websocket-is-a-transport.md) | WebSocket is a transport, not a second write path |
| [0012](./decisions/0012-cache-keys-are-tenant-first.md) | Cache keys start with the tenant id, and not via `@nestjs/cache-manager` |
| [0013](./decisions/0013-batch-rpcs-map-from-keys.md) | A batch RPC result maps from the requested keys, never from response order |
| [0014](./decisions/0014-narrow-graphql-edge-types.md) | Narrow GraphQL edge types, not field guards |
| [0015](./decisions/0015-prompt-injection-layers.md) | Direct prompt injection: regex, a cheap LLM, and a nonce boundary |
| [0016](./decisions/0016-ocr-is-a-per-page-branch.md) | OCR is a per-page branch, and the offline requirement bends but does not break |
| [0017](./decisions/0017-attachments-reach-retrieval.md) | An attachment must reach retrieval, not only generation |
| [0018](./decisions/0018-inbound-email-routing-and-threading.md) | Inbound email: token in the local part, authoritative threading |
| [0019](./decisions/0019-notification-grouping-is-unread-scoped.md) | Notification grouping is scoped to unread |
| [0020](./decisions/0020-email-uniqueness-is-per-tenant.md) | Email uniqueness is per-tenant, enforced twice |
| [0021](./decisions/0021-email-verified-is-a-jwt-claim.md) | `is_email_verified` is a JWT claim, and the staleness is accepted |
| [0022](./decisions/0022-no-cross-service-fks.md) | Cross-service references have no FK; validate at write time over gRPC |
| [0023](./decisions/0023-internal-notes-are-stripped-before-serialization.md) | Internal notes are stripped at read time, before serialization |
| [0024](./decisions/0024-one-upload-mechanism.md) | One upload mechanism: presign → confirm, with a `PendingUpload` record |
| [0025](./decisions/0025-chunk-usage-is-a-projection.md) | Chunk usage is a projection, not a query over the ledger |
| [0026](./decisions/0026-stripe-webhook-idempotency.md) | Stripe webhook idempotency is a UNIQUE constraint, not a check |
| [0027](./decisions/0027-lock-state-is-constrained-not-conventional.md) | The lock state matrix is enforced by a CHECK, and one state is deliberately unsupported |
| [0028](./decisions/0028-swagger-envelope-is-a-per-route-decorator.md) | The OpenAPI envelope is a per-route decorator, not a global wrapper |
| [0029](./decisions/0029-graphql-caches-entities-not-responses.md) | GraphQL caches entities, not responses, and the session key is never the token |
| [0030](./decisions/0030-refused-turns-exclude-their-attachments.md) | A refused turn's attachments are excluded per turn, not per file |
| [0031](./decisions/0031-narrow-dtos-at-the-gateway-boundary.md) | The gateway defines narrow DTOs; it never republishes a proto type |
| [0032](./decisions/0032-unversioned-breaking-changes-are-counted.md) | Breaking changes ship unversioned while no client exists — and are counted |
| [0033](./decisions/0033-redis-noeviction.md) | One Redis instance, `noeviction`, and three connections that stay separate |
| [0034](./decisions/0034-read-repopulate-race-is-accepted.md) | The cache read-repopulate race is accepted, not fixed |
| [0035](./decisions/0035-ocr-language-cap-is-a-cpu-bound.md) | The OCR language cap is four, and it is a CPU bound |
| [0036](./decisions/0036-scope-fanout-order-is-asymmetric.md) | Scope fan-out order is asymmetric, and restrictions are synchronous |
| [0037](./decisions/0037-worklists-follow-the-document-boundary.md) | Operational worklists follow the document boundary |
| [0038](./decisions/0038-permissions-are-a-compile-time-artifact.md) | Permissions are a compile-time artifact, not data |
| [0039](./decisions/0039-the-seeder-ddl-block-is-the-list.md) | The seeder's DDL block is the list of hand-written SQL |
| [0040](./decisions/0040-ticket-status-history-is-a-table-not-a-trail.md) | A ticket's status history is a table, not an audit trail |
| [0041](./decisions/0041-durable-subjects-are-the-ones-with-nothing-to-reconcile-against.md) | Durable subjects are the ones with nothing to reconcile against |
| [0042](./decisions/0042-schema-reaches-production-through-migrate-deploy.md) | Schema reaches production through `prisma migrate deploy` |
| [0043](./decisions/0043-the-cluster-shape.md) | The cluster shape: one Postgres instance, an initContainer, and `ingress-nginx` |
| [0044](./decisions/0044-expand-and-contract-never-in-one-release.md) | Expand and contract, never in one release |
| [0045](./decisions/0045-uri-versioning-under-the-same-paths.md) | URI versioning is on at `v1`, and no path moved to turn it on |

## `reference/` — what is true today

A **fixed set**, describing what is true today — closed by intent rather than by count. A new *feature* updates one of these; a new *kind of thing* may add one, and adding one is a deliberate act with its reason recorded here. The rule exists to stop per-feature proliferation, not to freeze the shelf.

| Document | Describes |
| :---- | :---- |
| [ai-output-contract.md](./reference/ai-output-contract.md) | Parse-site defaults and the Markdown answer contract |
| [sys-flows.md](./reference/sys-flows.md) | The core cross-service flows, as mermaid |
| [known-gaps.md](./reference/known-gaps.md) | What is currently broken or inconsistent, with the file that proves it |
| [flows/](./reference/flows/) | One document per end-to-end path — what happens, which components, which edge cases |
| [caching.md](./reference/caching.md) | What is cached, keyed how, invalidated by what |
| [scheduling.md](./reference/scheduling.md) | The nine scheduled jobs — cadence, steps, owner, and how you know one stopped |
| [erd/](./reference/erd/) | **Generated** — one entity-relationship diagram per service. Never hand-edit |

## Diagrams

**Diagrams live with the thing they describe, not in a folder of their own.** A
folder that only grows is the problem the numbered files already demonstrated,
and a diagram rots more quietly than prose because nobody re-renders one to
check it. So they are sorted the same way everything else here is — by what
invalidates them:

| Kind | Where it goes | Why it cannot rot |
| :---- | :---- | :---- |
| Illustrates a **decision** | Inline in the ADR that owns it | ADRs are append-only, so the diagram freezes with the decision |
| A **cross-service comparison** | Inline in [sys-flows.md](./reference/sys-flows.md) — as content, never a new page | The edit that changes the prose shows you the diagram |
| An **end-to-end path** | Inline in its own [reference/flows/](./reference/flows/) document | Split by what invalidates them: an OCR change rewrites one flow and touches no other |
| **Derivable from source** | Generated: `reference/erd/` today | Regenerating *is* the update |
| Per-endpoint, per-function | **Nowhere.** There are hundreds of routes and each hand-written artifact is stale on arrival — Swagger already documents endpoints from the code. A *flow* is the unit instead: many endpoints enter one | — |

**Format is mermaid in markdown, not `.drawio`.** A mermaid change is reviewable
in a diff; a `.drawio` change is an opaque blob where you cannot tell whether an
arrow reversed. It also renders on GitHub with no export step, so there is no
committed SVG to drift from its source. Reach for drawio only for a presentation
artifact — an architecture poster — which is not documentation.

### The ERDs

`npm run db:generate` regenerates all four, because each `schema.prisma`
declares a `prisma-erd-generator` block alongside its client generator. There is
no server to start and no database connection involved — the generator reads the
schema, not the data.

**There is deliberately no unified ERD.** Prisma cannot express a relation across
schemas, and the cross-service edges are absent from every schema on purpose —
see [ADR 0022](./decisions/0022-no-cross-service-fks.md). Merging the four into
one diagram would draw foreign keys that do not exist. The ownership map that
*does* span services is hand-drawn, in `sys-flows.md`, and changes only when a
new kind of cross-service reference is introduced.

## The numbered `NN-*.md` files

Working documents. Each one exists so a feature can be transferred from prose into code, and is **deleted once that transfer is done**.

They are therefore not part of the permanent documentation and **nothing durable may link to them** — not this page, not `decisions/`, not `reference/`, not a docblock. Anything in one that outlives the transfer belongs in an ADR (why) or in `reference/` (what is true now); anything that does not is disposable by design.

---

When a rule in `development-conventions.md` conflicts with the code, one of them is wrong — say which in the PR rather than silently following the other.
