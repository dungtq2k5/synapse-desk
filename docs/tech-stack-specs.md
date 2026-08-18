# **Comprehensive Tech Stack Specification**

## **1. Architectural Model Overview**

The system is designed as a **Polyglot Hybrid Microservices Architecture**:

* **TypeScript (Node.js)** drives core business logic, API gateways, authentication, real-time client communication, and helpdesk operations.
* **Python** powers the high-performance RAG (Retrieval-Augmented Generation) microservice for document ingestion, parsing, embedding, and vector retrieval.
* **Synchronous IPC:** gRPC (via Protocol Buffers) for sub-millisecond cross-language function calls.
* **Asynchronous IPC:** NATS JetStream for persistent domain event streams across microservices.
* **Background Processing:** BullMQ (Redis) for heavy job execution (file uploads, parsing queues).

## **2. Frontend Layer**

| Technology | Role / Purpose | Why Selected |
| :---- | :---- | :---- |
| **React (v18+)** | User Interface Framework | Component-based, highly responsive, extensive ecosystem for enterprise dashboards. |
| **Vite** | Frontend Build Tool | Extremely fast ESM-based HMR (Hot Module Replacement) and optimized production builds. |
| **Tailwind CSS** | Utility-First Styling | Rapid design iteration, uniform design tokens, zero runtime CSS overhead. |
| **Lucide React** | UI Iconography | Lightweight, consistent SVG icon set for enterprise interfaces. |
| **Recharts** | Data Visualization | Composably renders real-time performance metrics and deflection analytics. |

## **3. Backend Core Tier (TypeScript / Node.js)**

| Layer / Subsystem | Primary Technology | Core Libraries / Tooling | Justification |
| :---- | :---- | :---- | :---- |
| **Framework** | **NestJS (v10+)** | @nestjs/core, @nestjs/microservices | Enterprise-grade modular structure, native support for gRPC, NATS, GraphQL, and WebSockets. |
| **Compiler** | **SWC (@swc/core)** | @swc/jest | Sub-second TypeScript compilation and ultra-fast build/test cycles compared to tsc or ts-node. |
| **API Protocols** | **GraphQL & REST** | @nestjs/graphql, @apollo/server, @nestjs/swagger | GraphQL for flexible UI data fetching; REST/Swagger for file uploads and external webhooks. |
| **Real-time Engine** | **Socket.IO** | @socket.io/redis-adapter | Token-by-token LLM output streaming and multi-instance WebSocket state synchronization via Redis. |
| **ORM** | **Prisma ORM** | @prisma/client | Auto-generated, end-to-end type safety with declarative PostgreSQL schema management. |

## **4. AI & RAG Microservice Tier (Python 3.11+)**

| Layer / Subsystem | Primary Technology | Alternatives Evaluated | Justification |
| :---- | :---- | :---- | :---- |
| **API & IPC Server** | **FastAPI + grpcio** | Flask, Sanic | Async-native Python framework; natively serves gRPC endpoints for TS communication. |
| **RAG Orchestration** | **LlamaIndex** | LangChain Python | Purpose-built indexing, document transformations, and context retrieval optimization. |
| **Document Parsing** | **Docling / Unstructured** | PyPDF, pdfplumber | Advanced multi-column PDF layouts, markdown table extraction, and embedded document parsing. |
| **Embedding Model** | **Gemini text-embedding-004** (768-dim) | HuggingFace bge-large-en-v1.5 | Ultra-low latency and native Google GenAI SDK integration — and no GPU node, which a local HuggingFace model would have required under GKE. **Never tenant-configurable:** a Qdrant collection fixes its vector dimension at creation, so changing model is a full re-embed migration, and per-tenant models would force per-tenant collections. |
| **Reranking Engine** | **FlashRank / Cohere Rerank** | BGE-Reranker | Lightweight, local, or API-based passage reranking to optimize context window precision before LLM inference. |

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
| :---- | :---- | :---- |
| **Sync RPC (Cross-Language)** | **gRPC + Protocol Buffers (.proto)** | Shared binary protocol specs between TS and Python services for immediate direct queries. |
| **Async Domain Events** | **NATS + NATS JetStream** | Ultra-lightweight Go-based messaging engine. Stores and replays events (ticket.created, document.indexed). |
| **Background Work Queues** | **BullMQ + Redis** | Handles heavy, asynchronous processing jobs (e.g., file chunking, bulk embedding pipelines) with retries and concurrency limits. |

## **6. Persistence, Caching & Data Storage**

| System Component | Technology | Description |
| :---- | :---- | :---- |
| **Primary Database** | **PostgreSQL (v15+)** | Relational store for users, tickets, device sessions, audit logs, and document metadata. |
| **Vector Database** | **Qdrant** | Rust-powered ANN engine. **Single collection, payload-partitioned by tenant** — not a collection per tenant, which carries per-collection overhead that degrades past a few hundred. `organization_id` gets a payload index with `is_tenant=true` so Qdrant co-locates each tenant's points on disk. Filtered top-k is native: Qdrant estimates filter cardinality and either traverses HNSW skipping non-matches or exact-scans the matching subset, so a filtered query still returns k results rather than post-filtering down to fewer. |
| **In-Memory Cache & Bus** | **Redis (v7+)** | Multi-purpose: HTTP caching (keyv), rate limiting, Socket.IO adapter, BullMQ queues, `storage-service`'s `PendingUpload` records, and the **AI quota counter** (`quota:{org}:{cycle}`) — the runtime spend check, since summing `ai_generations` on every request would be a growing scan on the hot path (RDM §1.14). |
| **Keyword Search (BM25)** | **PostgreSQL full-text search** (`tsvector` + GIN) | The lexical arm of hybrid retrieval, over `document_chunks.content_text`. Chosen over a separate search cluster because the text is already in Postgres and the tenant/department predicate is the same `WHERE` every other query uses — no second copy of the isolation rule in a second system. Qdrant's `MatchText` is a *filter*, not a ranker, so it cannot substitute; sparse vectors could, and are the documented upgrade path. |
| **Object Storage** | **Firebase Storage** (Google Cloud Storage) | One bucket, path-prefixed per tenant. Uploads are **presign → PUT direct to the bucket → confirm**: file bytes never pass through an application server. Owned exclusively by `storage-service`, the only holder of Storage-write credentials. See [10-storage-service.md](./10-storage-service.md). |

## **7. Security, Ingress & Infrastructure**

| Layer | Technology | Usage |
| :---- | :---- | :---- |
| **Ingress & Proxy** | **Nginx** | Reverse proxy, SSL termination, strict Content Security Policy (CSP) headers, custom error pages. |
| **Authentication** | **OAuth 2.0 / OIDC + 2FA** | Social login (Google/GitHub) alongside TOTP authenticator app support. |
| **Rate Limiting** | **ThrottlerStorageRedisService** | Distributed rate limiting across REST, GraphQL, and WebSocket protocols via Redis. |
| **Containerization** | **Docker & Kubernetes (GKE)** | Multi-stage Docker builds orchestrating local services (docker-compose) and production K8s clusters. |
| **Infrastructure as Code** | **Terraform** | Declarative provisioning for GKE, Memorystore (Redis), Cloud SQL (PostgreSQL), and the Firebase Storage bucket. Terraform is cloud-agnostic and unchanged by the AWS → GCP move; only the providers and resource types differ. |

## **8. Development, Testing & CI/CD Tooling**

* **Monorepo Manager:** Turborepo / NestJS CLI Workspace.
* **Testing:** **Jest** configured with @swc/jest for high-speed serial unit and integration testing.
* **Code Formatting & Linting:** ESLint, Prettier, and Husky Git hooks for pre-commit checks.
* **Continuous Integration:** GitHub Actions executing automated Docker multi-stage builds, unit/integration testing, license validation, and semantic tag release generation (CHANGELOG.md).
