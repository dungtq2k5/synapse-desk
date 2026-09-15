# **Comprehensive Tech Stack Specification**

## **1. Architectural Model Overview**

The system is designed as a **Polyglot Hybrid Microservices Architecture**:

- **TypeScript (Node.js)** drives core business logic, API gateways, authentication, real-time client communication, and helpdesk operations.
- **Python** powers the RAG (Retrieval-Augmented Generation) microservice: embedding, hybrid retrieval, reranking and every LLM call. **It does not parse documents** — extraction and chunking are TypeScript, in `ingestion-service` (§4a), and `rag-service` is read-only against `postgres_ingestion`.
- **Synchronous IPC:** gRPC (via Protocol Buffers) for sub-millisecond cross-language function calls.
- **Asynchronous IPC:** NATS JetStream for persistent domain event streams across microservices.
- **Background Processing:** BullMQ (Redis) for heavy job execution (file uploads, parsing queues).

## **2. Frontend Layer**

| Technology | Role / Purpose | Why Selected |
| :--- | :--- | :--- |
| **React (v18+)** | User Interface Framework | Component-based, highly responsive, extensive ecosystem for enterprise dashboards. |
| **Vite** | Frontend Build Tool | Extremely fast ESM-based HMR (Hot Module Replacement) and optimized production builds. |
| **Tailwind CSS** | Utility-First Styling | Rapid design iteration, uniform design tokens, zero runtime CSS overhead. |
| **Lucide React** | UI Iconography | Lightweight, consistent SVG icon set for enterprise interfaces. |
| **Recharts** | Data Visualization | Composably renders real-time performance metrics and deflection analytics. |

## **3. Backend Core Tier (TypeScript / Node.js)**

| Layer / Subsystem | Primary Technology | Core Libraries / Tooling | Justification |
| :--- | :--- | :--- | :--- |
| **Framework** | **NestJS (v10+)** | @nestjs/core, @nestjs/microservices | Enterprise-grade modular structure, native support for gRPC, NATS, GraphQL, and WebSockets. |
| **Compiler** | **SWC (@swc/core)** | @swc/jest | Sub-second TypeScript compilation and ultra-fast build/test cycles compared to tsc or ts-node. |
| **API Protocols** | **GraphQL & REST** | @nestjs/graphql, @apollo/server, @nestjs/swagger | GraphQL for flexible UI data fetching; REST/Swagger for file uploads and external webhooks. |
| **Real-time Engine** | **Socket.IO** | @socket.io/redis-adapter | Token-by-token LLM output streaming and multi-instance WebSocket state synchronization via Redis. |
| **ORM** | **Prisma ORM** | @prisma/client | Auto-generated, end-to-end type safety with declarative PostgreSQL schema management. |

## **4. AI & RAG Microservice Tier (Python 3.11+)**

| Layer / Subsystem | Primary Technology | Alternatives Evaluated | Justification |
| :--- | :--- | :--- | :--- |
| **IPC Server** | **`grpcio` (`grpc.aio`)** | FastAPI, Flask | **gRPC only — there is no HTTP listener and no FastAPI.** Nothing outside the cluster calls this service, so an HTTP surface would be a second entry point to secure for no caller. `grpcio-health-checking` serves `grpc.health.v1` on the same port, which is what makes the pod probeable without one. |
| **RAG Orchestration** | **None — hand-written** | LlamaIndex, LangChain | The pipeline is ~200 lines of explicit stages (retrieve → hydrate → rerank → assemble → generate). A framework earns its place by removing decisions; here every stage is a decision this system has already made differently from the default — hydrate-before-rerank ([ADR 0008](./decisions/0008-hydrate-before-rerank.md)), a per-request nonce boundary, cap checks before any work. `@langchain/textsplitters` is used **in ingestion-service** for chunking, and is the only piece of that ecosystem present. |
| **Postgres access** | **`asyncpg`, no ORM** | SQLAlchemy, Prisma | `rag-service` is **read-only** against `postgres_ingestion` and never writes a chunk row. The lexical arm is one hand-written query whose predicate is a tenant-isolation boundary — an ORM would hide the clause that must not be got wrong. |
| **Embedding Model** | **Gemini text-embedding-004** (768-dim) | HuggingFace bge-large-en-v1.5 | Ultra-low latency and native Google GenAI SDK integration — and no GPU node, which a local HuggingFace model would have required under GKE. **Never tenant-configurable:** a Qdrant collection fixes its vector dimension at creation, so changing model is a full re-embed migration, and per-tenant models would force per-tenant collections. |
| **Reranking Engine** | **FlashRank / Cohere Rerank** | BGE-Reranker | Lightweight, local, or API-based passage reranking to optimize context window precision before LLM inference. |

### **4a. Document & attachment parsing (TypeScript, in `ingestion-service`)**

Parsing is **not** in the Python service, and the split is deliberate: extraction is a per-upload batch job with a retry budget and a job row, while `rag-service` is on the synchronous request path. Putting an untrusted-file parser in the request path would give a malformed upload a way to spend a caller's latency.

| Format | Library | Note |
| :--- | :--- | :--- |
| PDF | **`pdfjs-dist`** | Text layer first; a page with no extractable text falls to OCR ([ADR 0016](./decisions/0016-ocr-is-a-per-page-branch.md)) |
| Scanned PDF | **Tesseract** | Per-page branch, not per-document. Language cap of four is a CPU bound ([ADR 0035](./decisions/0035-ocr-language-cap-is-a-cpu-bound.md)) |
| `.docx` | **`mammoth`** | To HTML, then to markdown via `turndown` + `turndown-plugin-gfm` |
| `.xlsx` | **`exceljs`** | One `## Sheet: …` section per sheet. The streaming reader does not work for this shape; the workbook is built then capped at `MAX_SHEET_ROWS` |
| Chunking | **`@langchain/textsplitters`** | The one piece of that ecosystem in the repo |
| Token counting | **`js-tiktoken`** | Metering, so `estimated_cost_micros` is booked from a count rather than a guess |

`.doc` is **not** parseable here — a real Word 97-2003 file is an OLE compound file rather than a zip — so it was removed from the document pipeline and stays storable only as a ticket attachment.

## **5. Inter-Service Communication & Task Transport**

```txt
+-----------------------------------------------------------------------------------+
|                                 INTER-SERVICE LAYER                               |
|                                                                                   |
|  +------------------------+   Sync gRPC (Protobuf)   +-------------------------+  |
|  | Node.js / TS Services  | <----------------------> |   Python RAG Service    |  |
|  +------------------------+                          +-------------------------+  |
|              |                                                    |               |
|              |         Async NATS JetStream Event Bus             |               |
|              +----------------------------------------------------+               |
+-----------------------------------------------------------------------------------+
```

| Communication Pattern | Technology | Implementation Detail |
| :--- | :--- | :--- |
| **Sync RPC (Cross-Language)** | **gRPC + Protocol Buffers (.proto)** | Shared binary protocol specs between TS and Python services for immediate direct queries. |
| **Async Domain Events** | **NATS + NATS JetStream** | Ultra-lightweight Go-based messaging engine. Stores and replays events (`ticket.created`, `document.indexed`). |
| **Background Work Queues** | **BullMQ + Redis** | Handles heavy, asynchronous processing jobs (e.g., file chunking, bulk embedding pipelines) with retries and concurrency limits. |

## **6. Persistence, Caching & Data Storage**

| System Component | Technology | Description |
| :--- | :--- | :--- |
| **Primary Database** | **PostgreSQL (v15+)** | Relational store for users, tickets, device sessions, audit logs, and document metadata. |
| **Vector Database** | **Qdrant** | Rust-powered ANN engine. **Single collection, payload-partitioned by tenant** — not a collection per tenant, which carries per-collection overhead that degrades past a few hundred. `organization_id` gets a payload index with `is_tenant=true` so Qdrant co-locates each tenant's points on disk. Filtered top-k is native: Qdrant estimates filter cardinality and either traverses HNSW skipping non-matches or exact-scans the matching subset, so a filtered query still returns k results rather than post-filtering down to fewer. |
| **In-Memory Cache & Bus** | **Redis (v7+)** | Multi-purpose: HTTP caching (keyv), rate limiting, Socket.IO adapter, BullMQ queues, `storage-service`'s `PendingUpload` records, and the **AI quota counter** (`quota:{org}:{cycle}`) — the runtime spend check, since summing `ai_generations` on every request would be a growing scan on the hot path (RDM §1.14). |
| **Keyword Search (BM25)** | **PostgreSQL full-text search** (`tsvector` + GIN) | The lexical arm of hybrid retrieval, over `document_chunks.content_text`. Chosen over a separate search cluster because the text is already in Postgres and the tenant/department predicate is the same `WHERE` every other query uses — no second copy of the isolation rule in a second system. Qdrant's `MatchText` is a _filter_, not a ranker, so it cannot substitute; sparse vectors could, and are the documented upgrade path. |
| **Object Storage** | **Firebase Storage** (Google Cloud Storage) | One bucket, path-prefixed per tenant. Uploads are **presign → PUT direct to the bucket → confirm**: file bytes never pass through an application server. Owned exclusively by `storage-service`, the only holder of Storage-write credentials. See [ADR 0024](./decisions/0024-one-upload-mechanism.md). |

## **7. Security, Ingress & Infrastructure**

| Layer | Technology | Usage |
| :--- | :--- | :--- |
| **Ingress & Proxy** | **`ingress-nginx`** + **`helmet`** | Reverse proxy and SSL termination are the Ingress's ([ADR 0043](./decisions/0043-the-cluster-shape.md) — `k8s/ingress.yaml`, one controller and one `Ingress`, not a hand-written `nginx.conf`). **Response-security headers are the application's**, not the proxy's: `helmet` in `main.ts`, reading `security-headers.config.ts`, with a CSP written against the one HTML page this gateway serves (Swagger UI) — versioned with the code that decides what that page may load, and surviving a change of ingress controller. Every other response is JSON, including errors, so there are no error pages to style. |
| **Authentication** | **OAuth 2.0 / OIDC + 2FA** | Social login (Google/GitHub) alongside TOTP authenticator app support. |
| **Rate Limiting** | **ThrottlerStorageRedisService** | Distributed rate limiting across REST, GraphQL, and WebSocket protocols via Redis. |
| **Billing** | **Stripe** (`stripe@22`) | Subscriptions and the plan catalogue. **Stripe owns what a plan costs; this system owns what it grants** (RDM Tables 40–41) — mirroring an amount would be two sources of truth diverging silently. Webhook idempotency is a UNIQUE constraint, not a check ([ADR 0026](./decisions/0026-stripe-webhook-idempotency.md)). |
| **Email delivery** | **`resend`** (Node SDK) | Domain E's email channel in both directions: notification-service sends through the Resend API with an idempotency key per send, and the gateway receives inbound mail as a Resend `email.received` webhook. Driven off NATS rather than gRPC — a caller never waits for a provider round trip. |
| **SMS delivery** | **`twilio`** | Domain E's SMS channel, same fire-and-forget shape. |
| **2FA** | **`otplib` + `qrcode`** | TOTP secrets and the enrolment QR. |
| **Metrics** | **`prom-client`** | RED metrics per route, exposed on a **separate internal listener** rather than a route, so "unreachable from the internet" is a property of the process. |
| **Containerization** | **Docker & Kubernetes (GKE)** | Multi-stage Docker builds orchestrating local services (docker-compose) and production K8s clusters. |
| **Infrastructure as Code** | **Terraform** | Declarative provisioning for GKE, Memorystore (Redis), Cloud SQL (PostgreSQL), and the Firebase Storage bucket. Terraform is cloud-agnostic and unchanged by the AWS → GCP move; only the providers and resource types differ. |

## **8. Development, Testing & CI/CD Tooling**

- **Monorepo Manager:** Turborepo / NestJS CLI Workspace.
- **Testing:** **Jest** configured with `@swc/jest` for high-speed serial unit and integration testing.
- **Code Formatting & Linting:** ESLint (`eslint.config.mjs`), Prettier (`.prettierrc`) and `markdownlint-cli2` (`.markdownlint-cli2.jsonc`). **Enforced in CI, not by local Git hooks** — there is no Husky and no pre-commit hook; CI's `static` job runs `lint`, `format:check`, `typecheck` and `proto:lint` on every pull request, and a failure there blocks the merge. The pre-PR checklist in §14.0 of [development-conventions.md](./development-conventions.md) lists the same commands to run locally.
- **CI/CD:** GitHub Actions, in two workflows that answer different questions. **`ci.yml`** runs on every pull request and on push to `main`: format, lint, typecheck, proto lint, build, unit tests, the e2e suites against a real stack, and the Python checks. License declarations are checked by a unit test (`publish-safety.spec.ts`), not a separate step. **`cd.yml`** runs only on push to `main` (never on a pull request): it builds the multi-stage Docker images, pushes them to Artifact Registry, and applies the Kubernetes manifests. There is no release tagging or CHANGELOG generation.
