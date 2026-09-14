# SynapseDesk

An enterprise AI helpdesk backend: a knowledge base your users can ask questions of, and a ticketing system that takes over when the answer is not in it.

Documents are uploaded, parsed, chunked and embedded; questions are answered by a retrieval pipeline that cites the chunks it used, refuses when the corpus does not support an answer, and hands off to a human agent when it should. Everything is multi-tenant, every AI call is metered against a plan, and inbound email becomes a ticket in the same thread the web UI writes to.

**This repository is the backend only** — seven services, a Cloudflare Worker, and the manifests to run them. There is no front end here.

## Contents

- [What is in here](#what-is-in-here)
- [Documentation](#documentation)
- [Setup, from A to Z](#setup-from-a-to-z)
- [Running the tests](#running-the-tests)
- [Docker images](#docker-images)
- [Kubernetes](#kubernetes)
- [The inbound email Worker](#the-inbound-email-worker)
- [License](#license)

## What is in here

A Turborepo monorepo. The npm workspaces are `apps/*` and `libs/*`; everything else is deliberately outside them.

| Service                                              | Port    | Speaks                   | Owns                                                        |
| :--------------------------------------------------- | :------ | :----------------------- | :---------------------------------------------------------- |
| [`api-gateway`](apps/api-gateway/)                   | `3000`  | HTTP, GraphQL, WebSocket | The only public surface. Auth, cache, rate limits, fan-out  |
| [`auth-service`](apps/auth-service/)                 | `5001`  | gRPC                     | Users, organizations, roles, 2FA, invitations, billing      |
| [`ticket-service`](apps/ticket-service/)             | `5002`  | gRPC                     | Tickets, messages, assignment, SLA, analytics rollups       |
| [`storage-service`](apps/storage-service/)           | `50253` | gRPC                     | Presigned upload/download against Firebase Storage          |
| [`ingestion-service`](apps/ingestion-service/)       | `5004`  | gRPC                     | Documents, parsing, OCR, chunking, embedding, quotas        |
| [`notification-service`](apps/notification-service/) | `5005`  | gRPC                     | Email, SMS, push, in-app, webhooks                          |
| [`rag-service`](apps/rag-service/)                   | `50255` | gRPC                     | Python. Retrieval, reranking, generation, injection defence |

| Also                                              | What it is                                                           |
| :------------------------------------------------ | :------------------------------------------------------------------- |
| [`libs/common`](libs/common/)                     | Contracts, constants and configs every Node service imports          |
| [`libs/grpc-proto`](libs/grpc-proto/)             | The `.proto` files and their generated types                         |
| [`workers/email-inbound`](workers/email-inbound/) | A Cloudflare Worker. Parses inbound MIME and posts it to the gateway |
| [`k8s/`](k8s/)                                    | Deployments, Services, StatefulSets, Ingress, NetworkPolicy          |
| [`docker/`](docker/)                              | The two Dockerfiles and the image checks                             |
| [`scripts/`](scripts/)                            | Key generation, seeding, schema verification, generators             |

Backing services, all from `docker-compose.yml`: four Postgres instances (one per schema-owning service — there are no cross-service foreign keys), Redis, NATS with JetStream, Qdrant, and the Firebase Storage emulator.

## Documentation

**[`docs/README.md`](docs/README.md) is the map.** Every document there has exactly one job and that page says which. The entry points worth knowing:

| If you want to                      | Read                                                                                                                                   |
| :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| Write code in this repo             | [`docs/development-conventions.md`](docs/development-conventions.md)                                                                   |
| Know why something is the way it is | [`docs/decisions/`](docs/decisions/) — 44 ADRs, append-only                                                                            |
| Follow an end-to-end path           | [`docs/reference/flows/`](docs/reference/flows/)                                                                                       |
| Build a client                      | [`docs/graphql-api.md`](docs/graphql-api.md), [`docs/websocket-api.md`](docs/websocket-api.md), [`docs/webhooks.md`](docs/webhooks.md) |
| Know what is currently broken       | [`docs/reference/known-gaps.md`](docs/reference/known-gaps.md)                                                                         |
| Deploy                              | [`k8s/README.md`](k8s/README.md)                                                                                                       |

## Setup, from A to Z

### Prerequisites

| Tool             | Version                                 | Why                                   |
| :--------------- | :-------------------------------------- | :------------------------------------ |
| Node             | **24.19.0** — see `.nvmrc`              | `nvm use` picks it up                 |
| npm              | **11.9.0** — pinned by `packageManager` | Workspaces                            |
| Docker + Compose | any current                             | The eight backing services            |
| Python           | **3.12**                                | `rag-service`; matches the image base |

Optional, and only for **scanned** PDFs: `poppler-utils` and `tesseract-ocr` on your PATH. `OcrService` probes for both at boot and degrades with a warning rather than failing, so skip them until you need OCR.

### 1. Install

```sh
npm ci
```

`workers/email-inbound` is outside the workspaces and carries its own lockfile — it is not installed by this and does not need to be until you deploy the Worker.

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

**Set `METRICS_HOST = 0.0.0.0` in `apps/api-gateway/.env` first.** It defaults to `127.0.0.1` and should, but a container scraping the host then reaches a socket that is not listening for it: the target reads `DOWN` on `/targets` and nothing on that page points at a bind address. It is the one failure worth knowing in advance.

**Teardown needs the flag even though startup does not.** `docker compose down` does **not** stop a profiled service — it removes the other eight, leaves this one running holding `synapsedesk-network`, prints `Resource is still in use`, and exits `0`. Only `--profile observability down` reaches it.

On a fresh database every `ScheduledJobMissing` fires after thirty minutes, which is correct: no job has run. Note that it also fires when the target is `DOWN`, so it is not by itself evidence that anything was scraped — `/targets` is.

### 4. Generate credentials

```sh
npm run keys:generate          # RS256 keypairs: access + 2FA
npm run keys:service-account   # throwaway Firebase service-account keys
```

`keys:generate` writes four files and **refuses to overwrite an existing one** — rotating the pair invalidates every access token already issued, so it is opt-in via `npm run keys:generate -- --force`.

| File                                       | Who holds it                                              |
| :----------------------------------------- | :-------------------------------------------------------- |
| `apps/auth-service/secrets/jwt-access.key` | auth-service — the only service that may **mint** a token |
| `apps/auth-service/secrets/jwt-2fa.key`    | auth-service                                              |
| `apps/api-gateway/secrets/jwt-access.pub`  | api-gateway — can only **verify**                         |
| `apps/api-gateway/secrets/jwt-2fa.pub`     | api-gateway                                               |

`keys:service-account` writes `apps/storage-service/serviceAccountKey.json` and `apps/auth-service/serviceAccountKey.json`. These are synthetic RSA credentials, not Google ones: `firebase-admin` refuses to initialize without a well-formed key, `cert()` makes no network call, and the Storage emulator never checks a signature. It is idempotent — it exits 0 when the file exists.

Real Google credentials are needed only for real Google sign-in and a real Storage bucket, neither of which local development requires.

### 5. Per-service `.env` files

Each service loads `.env` from its **own** directory, validated by a Joi schema at boot. Every key in each `.env.example` is required.

```sh
for s in api-gateway auth-service ticket-service ingestion-service \
         notification-service storage-service rag-service; do
  cp "apps/$s/.env.example" "apps/$s/.env"
done
```

**A plain copy does not boot.** These values are placeholders, and two of them fail in ways worth knowing in advance:

| Where                | Key                    | Change it to                                                                   | What happens otherwise                                                                                                                                                                                              |
| :------------------- | :--------------------- | :----------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| all four DB services | `DATABASE_URL`         | user `postgres`, password `password123456789` — whatever your root `.env` says | Cannot connect. The example ships `user:password`                                                                                                                                                                   |
| `auth-service`       | `SUPER_ADMIN_PASSWORD` | anything of your own, 12+ chars                                                | **Boot is refused.** Both published placeholder values are on a blocklist outside `NODE_ENV=test`, so a deployment that edited every line but this one cannot get a super-admin whose password is in the repository |

`INBOUND_EMAIL_SECRET` needs one more thing that no single file can state: the **same value** must reach `api-gateway`, `notification-service` and the Cloudflare Worker (`wrangler secret put INBOUND_SECRET`). Both examples now ship a byte-identical placeholder, and `env-contract.spec.ts` keeps them that way — because a mismatch between the gateway and notification is **silent**: `parseTicketReplyToken` returns `null` and every email reply opens a new ticket instead of threading, with nothing in a log.

Also worth setting now, though nothing refuses to boot without them:

- `TWO_FACTOR_MASTER_KEY` (auth-service) — 32 chars minimum.
- `GEMINI_API_KEY` (ingestion-service **and** rag-service) — no embeddings and no generated answers without it.
- `EMAIL_*` (notification-service) — SMTP host, user and an app password.
- Stripe keys (auth-service) are **optional**. Without them the billing endpoints return `UNAVAILABLE` and everything else, login included, is unaffected.

### 6. The Python environment

```sh
npm run setup:py
```

Creates `apps/rag-service/.venv` and installs both requirement files. `turbo run dev` launches rag-service from that venv, so it has to exist before step 8.

### 7. Build, then push the schema

```sh
npm run build      # libs first — the services resolve @synapsedesk/common from its dist/
npm run db:push    # prisma db push, then the objects Prisma cannot express
```

**Build before pushing.** `db:push` chains `db:schema`, which boots a Nest entry point that imports `@synapsedesk/common` from `libs/common/dist`. On a fresh clone that directory does not exist yet.

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

`turbo run dev` starts all seven. It already depends on `^build` and `db:generate`, so a Prisma client or a stale lib is not something you have to remember — but `nest start --watch` only watches a service's own `src/`, so an edit inside `libs/` during a session needs a rebuild to propagate.

On first boot auth-service seeds itself (`SEED_ON_BOOTSTRAP = true`): permissions, the system user, and the super admin from `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`. That account is how you log in.

| Reach                          | At                                                                                                                   |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| REST                           | `http://localhost:3000/api/v1`                                                                                       |
| GraphQL                        | `http://localhost:3000/graphql` — **not** under the prefix                                                           |
| Swagger                        | `http://localhost:3000/api/v1/docs`, with `SWAGGER_ENABLED = true`                                                   |
| Liveness / readiness / version | `/health`, `/health/ready`, `/version` — outside the prefix, because an orchestrator cannot negotiate an API version |
| Prometheus metrics             | `http://127.0.0.1:9464/metrics`                                                                                      |

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

Two things only `--apply` does, and the portal depends on the first: it creates the **marked** portal configuration (`metadata.synapsedesk_portal`) that `createPortalSession` insists on — until it exists, opening the billing portal is refused with a message naming this script — and it creates the Stripe webhook endpoint, printing its signing secret **exactly once**; put that in `apps/auth-service/.env` as `STRIPE_WEBHOOK_SECRET`.

## Running the tests

```sh
npm test                 # unit, every workspace
npm run test:py          # pytest, rag-service
npm run lint             # eslint + the model-literal check
npm run typecheck        # tsc --noEmit
```

End-to-end suites need the stack up and their own databases. `prisma db push` creates a missing database on connect, so this is the whole preparation:

```sh
npm run db:test:push
npm run test:e2e         # six suites, sequential
```

`npm run test:system` is **destructive** and says so: it flushes the entire dev Redis, drops the Qdrant collection and resets the JetStream streams, in setup _and_ teardown. Postgres is the only store it spares.

Several of the specs under `libs/common/src/configs/` are contract guards rather than unit tests — they check the manifests against the application, the images against the Dockerfiles, the env schemas against the `.env.example` files, and the flow documents against the symbols they cite. A `.env.example` that gains a key without a schema entry fails there.

## Docker images

Two Dockerfiles, eleven images. The Node services build from one file with a `SERVICE` build arg; ingestion adds OCR, and the four schema-owning services also build a `migrate` target for their init container.

```sh
docker build -f docker/node-service.Dockerfile \
  --target runtime \
  --build-arg SERVICE=api-gateway \
  --build-arg GIT_SHA="$(git rev-parse HEAD)" \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t api-gateway .
```

| Target        | Used by                                                                                                                                                                                                                                       |
| :------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime`     | api-gateway, auth, ticket, notification, storage                                                                                                                                                                                              |
| `runtime-ocr` | ingestion-service — adds poppler and one Tesseract language pack per `OCR_LANGUAGES` entry                                                                                                                                                    |
| `migrate`     | auth, ticket, ingestion, notification. `FROM build`, not `FROM runtime` — the Prisma CLI is a devDependency and `prisma.config.ts` loads through TypeScript. 3.17 GB against runtime's 1.01 GB, and it runs for seconds in a pod's init phase |

rag-service builds from `docker/rag-service.Dockerfile`; its stages genuinely differ. `./docker/check-images.sh` builds everything and asserts the runtime trees resolve — minutes, not seconds, so run it when the Dockerfiles change.

To run a locally built image against the Compose stack, generate the per-service container env first — it rewrites host addresses to Compose service names:

```sh
node scripts/generate-docker-env.mjs
docker run --network synapsedesk-network --env-file apps/api-gateway/.env.docker api-gateway
```

## Kubernetes

[**`k8s/README.md`**](k8s/README.md) owns this. Seven Deployments, seven Services, one Ingress, two StatefulSets and one NetworkPolicy; the decisions are [ADR 0043](docs/decisions/0043-the-cluster-shape.md).

Four things it does **not** create and will not tell you about twice: a namespace, a CNI that actually enforces NetworkPolicy, a default `StorageClass`, and an `ingress-nginx` controller. Read _Before the first apply_ before the first apply — an existing database built by `db push` has no `_prisma_migrations` row and needs `prisma migrate resolve --applied 0_init`, or `migrate deploy` will try to create tables that are already there.

`ConfigMaps` and `Secret` skeletons under `k8s/generated/` are generated from each service's `.env.example` and must not be hand-edited:

```sh
node scripts/generate-k8s-config.mjs --check
```

## The inbound email Worker

[**`workers/email-inbound/README.md`**](workers/email-inbound/README.md) owns this. It is a Cloudflare Worker, deployed with `wrangler`, not part of the cluster:

```sh
cd workers/email-inbound
npm install
npx wrangler secret put INBOUND_SECRET   # must equal the gateway's INBOUND_EMAIL_SECRET
npx wrangler deploy
```

Point `wrangler.toml`'s two URLs at the real gateway host, then enable Email Routing and add a **catch-all** rule — the tenant lives in the local part (`support+{token}@…`), so every tenant shares one route.

**Do the MX record last.** Everything before it is testable from a recorded payload; pointing a live MX record at an unfinished endpoint means debugging business logic through a mail transport, where every iteration is an email you send yourself and wait for.

## License

Copyright (C) 2026 [dungtq2k5](https://github.com/dungtq2k5).

SynapseDesk is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License, version 3** as published by the Free Software Foundation. The full text is in [LICENSE](LICENSE).

It is distributed in the hope that it will be useful, but **without any warranty** — without even the implied warranty of merchantability or fitness for a particular purpose. See the license for details.

**Section 13 is the clause that matters for a backend like this one.** Running a modified version to serve users over a network counts as conveying it: whoever does that must offer those users the corresponding source of their modified version. Running it unmodified, or using it internally, triggers nothing.
