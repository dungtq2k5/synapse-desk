# SynapseDesk

An enterprise AI helpdesk: a knowledge base your users can ask questions of, and a ticketing system that takes over when the answer is not in it.

Documents are uploaded, parsed, chunked and embedded; questions are answered by a retrieval pipeline that cites the chunks it used, refuses when the corpus does not support an answer, and hands off to a human agent when it should. Everything is multi-tenant, every AI call is metered against a plan, and inbound email becomes a ticket in the same thread the web UI writes to.

This repository holds the seven backend services, the web client (`apps/web`), and the manifests to run them.

## Contents

- [What is in here](#what-is-in-here)
- [Documentation](#documentation)
- [Setup, from A to Z](#setup-from-a-to-z)
- [The web client](#the-web-client)
- [Running the tests](#running-the-tests)
- [Docker images](#docker-images)
- [Kubernetes](#kubernetes)
- [Inbound email](#inbound-email)
- [License](#license)

## What is in here

A Turborepo monorepo in three parts: `apps/` holds the clients, `services/` holds the backends, and `packages/` holds the code they share. The npm workspaces are `apps/*`, `services/*` and `packages/*`; everything else is deliberately outside them.

| Client | Port | What it is |
| :--- | :--- | :--- |
| [`apps/web`](apps/web/) | `5173` | Next.js (App Router), shadcn/ui on Tailwind CSS. It renders pages and calls the gateway's public API, nothing else — see [The web client](#the-web-client) |

| Service | Port | Speaks | Owns |
| :--- | :--- | :--- | :--- |
| [`api-gateway`](services/api-gateway/) | `3000`, Socket.IO on `3001` | HTTP, GraphQL, WebSocket | The only public surface, in Spring Boot. Auth, cache, rate limits, fan-out |
| [`auth-service`](services/auth-service/) | `5001` | gRPC | Users, organizations, roles, 2FA, invitations, billing |
| [`ticket-service`](services/ticket-service/) | `5002` | gRPC | Tickets, messages, assignment, SLA, analytics rollups |
| [`storage-service`](services/storage-service/) | `50253` | gRPC | Presigned upload/download against Firebase Storage |
| [`ingestion-service`](services/ingestion-service/) | `5004` | gRPC | Documents, parsing, OCR, chunking, embedding, quotas |
| [`notification-service`](services/notification-service/) | `5005` | gRPC | Email, SMS, push, in-app, webhooks |
| [`rag-service`](services/rag-service/) | `50255` | gRPC | Python. Retrieval, reranking, generation, injection defence |

| Also | What it is |
| :--- | :--- |
| [`packages/api-client`](packages/api-client/) | Browser-safe: the web's REST client, **generated** from `docs/reference/openapi.json` by Orval, and its fetcher |
| [`packages/contracts`](packages/contracts/) | Browser-safe: event names and shapes, enum values, limits, permission codes |
| [`packages/core`](packages/core/) | Browser-safe pure functions: email normalisation, masking, limit comparison, job staleness |
| [`packages/nest-common`](packages/nest-common/) | Server code the TypeScript services share: NATS and JetStream, publishers, tenant scope, the SSRF guard |
| [`packages/grpc-proto`](packages/grpc-proto/) | The `.proto` files and their generated types |
| [`packages/testing`](packages/testing/) | Helpers the test suites share; never shipped |
| [`packages/config`](packages/config/) | The repo-wide guard specs |
| [`k8s/`](k8s/) | Deployments, Services, StatefulSets, Ingress, NetworkPolicy |
| [`docker/`](docker/) | The Dockerfiles and the image checks |
| [`scripts/`](scripts/) | Key generation, seeding, schema verification, generators |

Backing services, all from `docker-compose.yml`: four Postgres instances (one per schema-owning service — there are no cross-service foreign keys), Redis, NATS with JetStream, Qdrant, and the Firebase emulators (the `firebase` service: Storage on 9199, Authentication on 9099, so Google sign-in works locally with no Google account; presigned uploads work against it too: storage-service hands out the emulator's own upload URL, with `uploadMethod: POST`, since the emulator refuses signed URLs).

## Documentation

**[`docs/README.md`](docs/README.md) is the map.** Every document there has exactly one job and that page says which. The entry points worth knowing:

| If you want to | Read |
| :--- | :--- |
| Write code in this repo | [`docs/development-conventions.md`](docs/development-conventions.md) |
| Know why something is the way it is | [`docs/decisions/`](docs/decisions/) — 47 ADRs, append-only |
| Follow an end-to-end path | [`docs/reference/flows/`](docs/reference/flows/) |
| Build a client | [`docs/graphql-api.md`](docs/graphql-api.md), [`docs/websocket-api.md`](docs/websocket-api.md), [`docs/webhooks.md`](docs/webhooks.md) |
| Know what is currently broken | [`docs/reference/known-gaps.md`](docs/reference/known-gaps.md) |
| Deploy | [`k8s/README.md`](k8s/README.md) |

## Setup, from A to Z

### Prerequisites

| Tool | Version | Why |
| :--- | :--- | :--- |
| Node | **24.19.0** — see `.nvmrc` | `nvm use` picks it up |
| npm | **11.9.0** — pinned by `packageManager` | Workspaces |
| Docker + Compose | any current | The eight backing services |
| Python | **3.12** | `rag-service`; matches the image base |
| JDK | **21** | `api-gateway`; Maven itself comes from the module's `./mvnw` |

Optional, and only for **scanned** PDFs: `poppler-utils` and `tesseract-ocr` on your PATH. `OcrService` probes for both at boot and degrades with a warning rather than failing, so skip them until you need OCR.

### 1. Install

```sh
npm ci
```

### 2. The root `.env` — read by Compose, and by nothing else

```sh
cp .env.example .env
```

Every `${VAR}` in `docker-compose.yml` resolves from this file. It is gitignored, and a missing value is not a missing feature: Compose substitutes an empty string, the Postgres containers come up with no user, no password and no database, and the failure surfaces much later as services that cannot connect.

The defaults are container credentials for a stack listening on localhost. Leave them alone unless you have a port conflict — the per-service `DATABASE_URL`s in step 5 have to agree with whatever you put here.

### 3. Start the backing services

```sh
docker compose up -d --wait
```

`--wait` waits only for services that declare a healthcheck. All eight in the default set do — Prometheus sits behind the `observability` profile and is not started by this command.

#### Optional: Prometheus, to read the alert rules

`docker/prometheus/job-alerts.yml` is generated from `SCHEDULED_JOBS` and holds a staleness and a missing-series rule per job. Nothing reads it unless you start this, which sits behind a profile so `docker compose up -d --wait` above — and CI — are unaffected.

```sh
docker compose up -d prometheus                     # naming it activates its profile
docker compose --profile observability down         # the teardown; see below
```

Then `http://localhost:9090` — `/targets`, `/rules` (18 today, 9 jobs x 2) and `/alerts`.

**Set `METRICS_HOST = 0.0.0.0` in `services/api-gateway/.env` first.** It defaults to `127.0.0.1` and should, but a container scraping the host then reaches a socket that is not listening for it: the target reads `DOWN` on `/targets` and nothing on that page points at a bind address. It is the one failure worth knowing in advance.

**Teardown needs the flag even though startup does not.** `docker compose down` does **not** stop a profiled service — it removes the other eight, leaves this one running holding `synapsedesk-network`, prints `Resource is still in use`, and exits `0`. Only `--profile observability down` reaches it.

On a fresh database every `ScheduledJobMissing` fires after thirty minutes, which is correct: no job has run. Note that it also fires when the target is `DOWN`, so it is not by itself evidence that anything was scraped — `/targets` is.

### 4. Generate credentials

```sh
npm run keys:generate          # RS256 keypairs: access + 2FA
npm run keys:service-account   # throwaway Firebase service-account keys
npm run keys:test-tls          # the self-signed pair the e2e receivers listen with
```

`keys:generate` writes four files and **refuses to overwrite an existing one** — rotating the pair invalidates every access token already issued, so it is opt-in via `npm run keys:generate -- --force`.

| File | Who holds it |
| :--- | :--- |
| `services/auth-service/secrets/jwt-access.key` | auth-service — the only service that may **mint** a token |
| `services/auth-service/secrets/jwt-2fa.key` | auth-service |
| `services/api-gateway/secrets/jwt-access.pub` | api-gateway — can only **verify** |
| `services/api-gateway/secrets/jwt-2fa.pub` | api-gateway |

`keys:service-account` writes `services/storage-service/serviceAccountKey.json` and `services/auth-service/serviceAccountKey.json`. These are synthetic RSA credentials, not Google ones: `firebase-admin` refuses to initialize without a well-formed key, `cert()` makes no network call, and the Storage emulator never checks a signature. Its `project_id` is `synapsedesk-test`, the emulators' project, which is what lets auth-service accept the Auth emulator's Google ID tokens: **put a real Firebase project's key in `services/auth-service/` and Google sign-in fails locally** ("incorrect aud claim"). It is idempotent — it exits 0 when the file exists.

`keys:test-tls` writes `receiver-key.pem` and `receiver-cert.pem` into `services/notification-service/test/fixtures/` and `services/storage-service/test/fixtures/`. Two e2e suites start a real `https` server on an ephemeral port — the outbound-webhook sender and the remote-source fetcher — and `createServer` needs the pair on disk. Nothing verifies the certificate (the sender's dev hatch relaxes that for a localhost receiver, which is self-signed by nature), so it is generated rather than committed. Skip it and `npm run test:e2e` fails with `ENOENT … receiver-key.pem` before its first assertion. Idempotent: it exits 0 unless the pair is missing or expired, and `-- --force` replaces it.

Real Google credentials are needed only for real Google sign-in and a real Storage bucket, neither of which local development requires.

### 5. Per-service `.env` files

Each service loads `.env` from its **own** directory, validated by a Joi schema at boot. Every key in each `.env.example` is required. The gateway is the exception in mechanism, not in practice: Spring reads no `.env`, so its npm scripts load `.env`, then `.env.example` for any key it lacks. The web client's `.env` holds one key, `GATEWAY_URL`.

```sh
for s in api-gateway auth-service ticket-service ingestion-service \
         notification-service storage-service rag-service; do
  cp "services/$s/.env.example" "services/$s/.env"
done
cp apps/web/.env.example apps/web/.env
```

**A plain copy does not boot.** These values are placeholders, and two of them fail in ways worth knowing in advance:

| Where | Key | Change it to | What happens otherwise |
| :--- | :--- | :--- | :--- |
| all four DB services | `DATABASE_URL` | user `postgres`, password `password123456789` — whatever your root `.env` says | Cannot connect. The example ships `user:password` |
| `auth-service` | `SUPER_ADMIN_PASSWORD` | anything of your own: 12+ characters, with a lowercase letter, an uppercase letter, a digit and a symbol | **Boot is refused.** Both published placeholder values are on a blocklist outside `NODE_ENV=test`, so a deployment that edited every line but this one cannot get a super-admin whose password is in the repository |

`INBOUND_EMAIL_SECRET` needs one more thing that no single file can state: the **same value** must reach `api-gateway` and `notification-service`. Both examples ship a byte-identical placeholder, and `env-contract.spec.ts` keeps them that way — because a mismatch between the gateway and notification is **silent**: `parseTicketReplyToken` returns `null` and every email reply opens a new ticket instead of threading, with nothing in a log.

Also worth setting now, though nothing refuses to boot without them:

- `TWO_FACTOR_MASTER_KEY` (auth-service) — 32 chars minimum.
- `GEMINI_API_KEY` (ingestion-service **and** rag-service) — no embeddings and no generated answers without it.
- `RESEND_API_KEY` (notification-service) — a sending-only Resend key, with `EMAIL_SENDER` on a domain verified in Resend. Without a verified domain, `onboarding@resend.dev` sends only to the Resend account's own address.
- `RESEND_GATEWAY_API_KEY` and `RESEND_WEBHOOK_SECRET` (api-gateway) — inbound mail; see [Inbound email](#inbound-email).
- Stripe keys (auth-service) are **optional**. Without them the billing endpoints return `UNAVAILABLE` and everything else, login included, is unaffected.

### 6. The Python environment

```sh
npm run setup:py
```

Creates `services/rag-service/.venv`, installs `requirements.lock` with every hash checked, then the development tools from `requirements-dev.txt`. `turbo run dev` launches rag-service from that venv, so it has to exist before step 8 — and `npm run format`, `format:check` and `check` run Ruff from it, so they need it too. After changing `requirements.txt`, `npm run lock:py` regenerates the lock; it needs [`uv`](https://docs.astral.sh/uv/).

### 7. Build, then push the schema

```sh
npm run build      # packages first — the services resolve them from their dist/
npm run db:push    # prisma db push, then the objects Prisma cannot express
```

**Build before pushing.** `db:push` chains `db:schema`, which boots a Nest entry point that imports the shared packages from their `dist/`. On a fresh clone those directories do not exist yet.

`db:push` is two steps on purpose: `prisma db push` creates every table and **none** of the partial indexes, so `schema-apply` follows with the objects the schema language has no syntax for — extensions, GIN indexes, and the partial unique indexes that make email uniqueness per-tenant. A database with the tables and without those looks correct and quietly permits what they refuse.

Then, once per ingestion database:

```sh
npm run projection:backfill -w @synapsedesk/ingestion-service
```

The nightly chunk-usage projection adds to counters from a cursor and refuses to run without one, because seeding it means resetting every chunk row — a lock the 02:00 job must not take on a live table. On an empty database this takes a second and seeds the cursor; skip it and that one nightly step fails until you run it.

### 8. Run

```sh
npm run dev
```

`turbo run dev` starts all seven services and the web client. It already depends on `^build` and `db:generate`, so a Prisma client or a stale lib is not something you have to remember — but `nest start --watch` only watches a service's own `src/`, so an edit inside `packages/` during a session needs a rebuild to propagate. The gateway runs under `./mvnw -q spring-boot:run` and does not reload: restart it after an edit.

On first boot auth-service seeds itself (`SEED_ON_BOOTSTRAP = true`): permissions, the system user, and the super admin from `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`. That account is how you log in. **A Super Admin must use two-step.** In development and tests, `SUPER_ADMIN_TOTP_SECRET` (a base32 secret, refused under production) enrolls it at boot, new or existing, so signing in by hand needs an authenticator holding that secret, and scripts compute the code with `otplib`. A code is accepted once per 30-second step. Without the setting, the Super Admin enrolls at their first sign-in.

| Reach | At |
| :--- | :--- |
| The web client | `http://localhost:5173`. It proxies `/api`, `/graphql` and `/socket.io` to the gateway, so the browser sees one origin |
| REST | `http://localhost:3000/api/v1` — prefix `api` + URI version `v1`; `GLOBAL_PREFIX` is the word, not the path |
| GraphQL | `http://localhost:3000/graphql` — **not** under the prefix |
| API documentation, browsable | `http://localhost:8081` (`SWAGGER_UI_PORT`), after `docker compose up -d swagger-ui`: Swagger UI behind the `docs` profile, reading the committed `docs/reference/openapi.json`. Sign in through its `/auth/login`, and the other calls carry the cookie. Development only: the gateway itself serves no page |
| OpenAPI document | `http://localhost:3000/v3/api-docs`, with `SWAGGER_ENABLED = true` — the gateway serves no documentation UI; the same document as a tracked file at [`docs/reference/openapi.json`](docs/reference/openapi.json), regenerated by `npm run openapi:export` |
| Liveness / readiness / version | `/health`, `/health/ready`, `/version` — outside the prefix, because an orchestrator cannot negotiate an API version |
| Prometheus metrics | `http://127.0.0.1:9464/metrics` |

### 9. Optional: billing catalogue and demo data

Both are dry-run by default and print exactly what they would write.

```sh
npm run stripe:provision          # Products, Prices and a portal config, in your Stripe sandbox
npm run stripe:provision:apply
npm run plans:seed                # subscription_plans, reading the ids back from Stripe
npm run plans:seed:apply
npm run seed:demo                 # a populated tenant; needs the stack running
npm run seed:demo:apply
```

`stripe:provision` reads `STRIPE_RESTRICT_KEY` and `STRIPE_WEBHOOK_URL` from the **root** `.env`. A restricted key (`rk_test_…`) scoped to Products, Prices, Billing Portal and Webhook Endpoints (read **and** write — the dry run lists before it decides) is all it needs; a full `sk_` reaches much further than the job.

Two things only `--apply` does, and the portal depends on the first: it creates the **marked** portal configuration (`metadata.synapsedesk_portal`) that `createPortalSession` insists on — until it exists, opening the billing portal is refused with a message naming this script — and it creates the Stripe webhook endpoint, printing its signing secret **exactly once**; put that in `services/auth-service/.env` as `STRIPE_WEBHOOK_SECRET`.

## The web client

`apps/web` is a **renderer, not a backend** ([ADR 0047](docs/decisions/0047-the-web-server-is-a-renderer.md)). Its server renders pages by forwarding the browser's own cookies to the gateway's public API, with `cache: 'no-store'` on every call. It never refreshes a token, never calls a service directly, and never decides who may see what. When the gateway answers 401 during server rendering, the page renders without its data, and the browser fetches, refreshes once and retries.

- **REST by default.** The client is generated: `npm run generate` writes `packages/api-client/src/generated/` from the committed `docs/reference/openapi.json`, so a breaking change to the document fails the web's typecheck. GraphQL is used only where REST can't serve a screen, and no screen needs it yet.
- **Design tokens** come from Figma as W3C design-token JSON, committed under `apps/web/design-tokens/`. Style Dictionary turns them into CSS variables (`npm run tokens -w @synapsedesk/web`, run by `dev`, `build` and `typecheck`). Components use semantic tokens only. A guard fails on a colour literal or a Tailwind palette class.
- **Components** are shadcn/ui, copied into `apps/web/src/components/ui/` and ours to change.
- **Realtime:** one Socket.IO client per tab, on the gateway's `/ws` namespace, through `/socket.io`.
- **Security headers:** `src/proxy.ts` sets a per-request nonce and the Content-Security-Policy. It does nothing else, and in particular nothing about who is signed in.

In the cluster the Ingress sends `/api`, `/graphql` and `/socket.io` to the gateway and everything else to `web` (`k8s/ingress.yaml`); `docker/web.Dockerfile` builds the image from Next's standalone output.

## Running the tests

```sh
npm test                 # unit, every workspace
npm run test:py          # pytest, rag-service
npm run check            # lint, lint:py, format:check, typecheck, typecheck:py
```

Tests print their results, not the services' logs. When a failure needs the logs, `TEST_LOGS=1 npm test` brings the Nest logs back, and `TEST_LOG_LEVEL=INFO` does the same for the gateway's Maven tests.

CI's `sonar` job sends each analysis to SonarCloud, with the coverage the unit, Python, Node e2e, web e2e, gateway and contract jobs write. The `e2e` job sets `E2E_COVERAGE_DIR` and uploads each suite's lcov, failing if none was written. The `e2e-web` job sets `WEB_COVERAGE_DIR`: the web is built with source maps, each row's browser coverage and the renderer's (`NODE_V8_COVERAGE`) are mapped back to the sources, and one lcov is written. `scripts/merge-lcov.mjs` folds every JavaScript lcov into one before the scan. **New code must stay at 90.0% or above:** the job waits for the analysis and fails below `NEW_CODE_COVERAGE_MIN`, printing the number. Java's coverage counts both `mvnw verify` and the contract suite: each contract shard runs its gateways under the JaCoCo agent (`CONTRACT_JACOCO_AGENT` names the jar; without it the harness launches the gateway plainly), and `scripts/report-contract-coverage.sh` fails if any launch wrote no coverage, then writes the shard's report. It runs on pushes to `main-java` only, SonarCloud's main branch: the organization's plan analyses no other branch, so pull requests are skipped too; `sonar-project.properties` says what is analysed and what counts toward coverage.

End-to-end suites need the stack up and their own databases. `prisma db push` creates a missing database on connect, so this is the whole preparation:

```sh
npm run db:test:push
npm run test:e2e         # six suites, sequential
```

With `E2E_COVERAGE_DIR` set, each Node e2e suite also writes `<dir>/<service>/lcov.info`, with paths relative to the repository.

`npm run test:e2e:web` drives the web client in Chromium across the whole system (`test/e2e-web/`, Playwright): sign-in through every leg, the expired-session fallback, a live reply between two browsers, and sign-out. That's the `chromium` project. The `screens` project drives **every state of every screen** and checks each one three ways:

- what it says;
- **axe** accessibility, in light and dark;
- a **screenshot baseline** at 1440 and 390 px, in light and dark, kept in `test/e2e-web/__screenshots__/`.

The baselines are drawn by the browser inside the pinned Playwright image, so fonts render the same on every machine. They protect an approved look from accidental change; they aren't compared with Figma. When a change is meant to move a screen, `npm run test:e2e:web:update-screens` redraws the baselines that changed, and the new PNGs are reviewed in the diff like code. Before a screen's first baseline is approved, compare it with its Figma frame.

The suite reuses `test:system`'s setup, so it is destructive in the same way. CI runs it in the `e2e-web` job. **Billing runs against a fake Stripe**, which `test:system`'s setup starts in-process: auth-service reaches it through `STRIPE_API_BASE_URL` (refused under `NODE_ENV=production`), the plans seed reads its catalog, its Checkout and portal pages redirect straight back, and it sends the signed webhooks that move entitlements. So the suite needs no Stripe key at all. A dev database seeded from the real sandbox holds price ids the fake doesn't know: run `node scripts/reset-databases.mjs --dev-only` once. Install the browser once with `npx playwright install chromium`.

The suite starts rag-service in its model-free mode (`RAG_OFFLINE_MODEL=true`, refused under `APP_ENV=production`), on every machine and in CI, so it needs no `GEMINI_API_KEY` and the AI journeys assert fixed text: embeddings are a fixed function of the words, and an answer reads "This answer comes from the offline model, citing [1]." for each source it found. ingestion-service has the same mode (`INGESTION_OFFLINE_MODEL=true`, refused under `NODE_ENV=production`), whose vectors are rag-service's, so an uploaded document is found by an offline question. The real model stays covered by rag-service's live tests in the Python job. **The Google sign-in rows need the internet:** Firebase's popup sign-in loads `apis.google.com/js/api.js` before it opens, even against the Auth emulator.

`npm run test:system` is **destructive** and says so: it flushes the entire dev Redis, drops the Qdrant collection and resets the JetStream streams, in setup _and_ teardown. Postgres is the only store it spares. **Don't run another suite against the dev stack while it runs:** rag-service's pytest uses the same Qdrant (`QDRANT_URL` in its `.env.test`) and errors when the collection is dropped under it.

The specs under `packages/config/src/` are contract guards rather than unit tests — they check the manifests against the application, the images against the Dockerfiles, the env schemas against the `.env.example` files, and the flow documents against the symbols they cite. A `.env.example` that gains a key without a schema entry fails there.

## Docker images

Four Dockerfiles, twelve images. The Node services build from one file with a `SERVICE` build arg; ingestion adds OCR, and the four schema-owning services also build a `migrate` target for their init container. The gateway builds from `docker/java-service.Dockerfile`, a Maven build and a JRE runtime, with the repository root as its context — it reads the protos and the published GraphQL schema. The web client builds from `docker/web.Dockerfile`, from Next.js's standalone output; `docker/check-images.sh --web-only` builds and boots it alone.

```sh
docker build -f docker/node-service.Dockerfile \
  --target runtime \
  --build-arg SERVICE=auth-service \
  --build-arg GIT_SHA="$(git rev-parse HEAD)" \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t auth-service .

docker build -f docker/java-service.Dockerfile \
  --build-arg GIT_SHA="$(git rev-parse HEAD)" \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t api-gateway .
```

| Target | Used by |
| :--- | :--- |
| `runtime` | auth, ticket, notification, storage |
| `runtime-ocr` | ingestion-service — adds poppler and one Tesseract language pack per `OCR_LANGUAGES` entry |
| `migrate` | auth, ticket, ingestion, notification. `FROM build`, not `FROM runtime` — the Prisma CLI is a devDependency and `prisma.config.ts` loads through TypeScript. 3.17 GB against runtime's 1.01 GB, and it runs for seconds in a pod's init phase |

rag-service builds from `docker/rag-service.Dockerfile`; its stages genuinely differ. `./docker/check-images.sh` builds every Node and rag image and asserts the runtime trees resolve — minutes, not seconds, so run it when the Dockerfiles change. `npm run images:boot-gateway` builds the gateway's image, starts it and waits for `/health`.

To run a locally built image against the Compose stack, generate the per-service container env first — it rewrites host addresses to Compose service names:

```sh
node scripts/generate-docker-env.mjs
docker run --network synapsedesk-network --env-file services/api-gateway/.env.docker api-gateway
```

## Kubernetes

[**`k8s/README.md`**](k8s/README.md) owns this. Eight Deployments (the seven services and the web client), eight Services, one Ingress, two StatefulSets and three NetworkPolicies; the decisions are [ADR 0043](docs/decisions/0043-the-cluster-shape.md).

Four things it does **not** create and will not tell you about twice: a namespace, a CNI that actually enforces NetworkPolicy, a default `StorageClass`, and an `ingress-nginx` controller. Read _Before the first apply_ before the first apply — an existing database built by `db push` has no `_prisma_migrations` row and needs `prisma migrate resolve --applied 0_init`, or `migrate deploy` will try to create tables that are already there.

`ConfigMaps` and `Secret` skeletons under `k8s/generated/` are generated from each service's `.env.example` and must not be hand-edited:

```sh
node scripts/generate-k8s-config.mjs --check
```

## Inbound email

Mail arrives through [Resend](https://resend.com): Resend receives it on `INBOUND_EMAIL_DOMAIN` and posts an `email.received` webhook to the gateway, which fetches the body with its own key. [`docs/reference/flows/inbound-email.md`](docs/reference/flows/inbound-email.md) owns the flow; [ADR 0046](docs/decisions/0046-resend-for-both-directions.md) the decision.

```sh
# root .env: RESEND_PROVISION_KEY (full access) and RESEND_WEBHOOK_URL
npm run resend:provision                    # dry run — what it would create
npm run resend:provision:apply              # create the webhook; prints its signing secret
npm run resend:provision -- --print-secret  # read the secret back later
```

Put the printed secret in the gateway's `.env` as `RESEND_WEBHOOK_SECRET`, beside `RESEND_GATEWAY_API_KEY` — a different key from notification-service's sending key. The tenant lives in the local part (`support+{token}@…`), so every tenant shares one receiving domain; a `.resend.app` address needs no DNS in development.

**Do the MX record last.** Everything before it is testable from a recorded payload; pointing a live MX record at an unfinished endpoint means debugging business logic through a mail transport, where every iteration is an email you send yourself and wait for.

## License

Copyright (C) 2026 [dungtq2k5](https://github.com/dungtq2k5).

SynapseDesk is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License, version 3** as published by the Free Software Foundation. The full text is in [LICENSE](LICENSE).

It is distributed in the hope that it will be useful, but **without any warranty** — without even the implied warranty of merchantability or fitness for a particular purpose. See the license for details.

**Section 13 is the clause that matters for a backend like this one.** Running a modified version to serve users over a network counts as conveying it: whoever does that must offer those users the corresponding source of their modified version. Running it unmodified, or using it internally, triggers nothing.
