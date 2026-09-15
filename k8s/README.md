# `k8s/` — the manifests

Seven Deployments, seven Services, one Ingress, two StatefulSets and one NetworkPolicy. The decisions behind them are [ADR 0043](../docs/decisions/0043-the-cluster-shape.md); this file is what you need to apply them.

## Layout

```txt
k8s/
  services/          Deployment + Service, one file per service
  infrastructure/    NATS and Qdrant StatefulSets (ADR 0043 keeps these in-cluster)
  policy/            NetworkPolicy — known gap #26's egress control
  ingress.yaml       the one Ingress; api-gateway only
  generated/         ConfigMaps and Secret SKELETONS — do not edit
```

`libs/common/src/configs/manifest-contract.spec.ts` checks these files against the application: probe ports against each `.env.example`, ConfigMap keys against each Joi schema, secret mount paths against the `*_PATH` values that resolve them, and ingestion's memory limit against the two constants that determine it.

## Regenerating `generated/`

```sh
node scripts/generate-k8s-config.mjs           # rewrite
node scripts/generate-k8s-config.mjs --check   # verify (what the spec runs)
```

The source is each service's **`.env.example`**, active and commented lines alike. `# METRICS_HOST = 127.0.0.1` is not a disabled setting — it is how this repository documents a default without setting it, and the cluster is the one place those defaults are wrong. A generator that read only active lines would drop `METRICS_HOST`, every `REDIS_DB` and rag-service's `GRPC_PORT`, which is exactly the set a pod overrides.

It is deliberately **not** `scripts/generate-docker-env.mjs`'s input. That script reads the developer's untracked `.env` and says so — _"the output may hold real credentials"_. These files are tracked. What transfers is its substitution table, not its source.

## What you must supply

Nothing in `generated/` carries a real value.

- **`REPLACE_ME`** in a ConfigMap is a per-deployment value: `CORS`, `APP_WEB_URL`, the sending address, the storage bucket, and so on.
- **`*.secret.example.yaml`** is a key list with empty values. Create the real Secret out of band — `kubectl create secret generic`, a sealed-secret controller, or your platform's secret manager. Never commit one.
- **File Secrets** are separate from the variable Secrets above, because they are mounted rather than injected:

  | Secret | contents | mounted at |
  | :--- | :--- | :--- |
  | `api-gateway-jwt-public` | `jwt-access.pub`, `jwt-2fa.pub` | `/app/apps/api-gateway/secrets/` |
  | `auth-service-files` | `jwt-access.key`, `jwt-2fa.key`, `serviceAccountKey.json` | `/app/apps/auth-service/secrets/` |
  | `storage-service-files` | `serviceAccountKey.json` | `/app/apps/storage-service/serviceAccountKey.json` |
  | `notification-service-files` | `serviceAccountKey.json` (optional — FCM) | `/app/apps/notification-service/serviceAccountKey.json` |

  **Three Firebase service accounts, three variable names, two directory conventions.** auth's is under `secrets/`; storage's and notification's are at the package root. The paths above are not a convention to remember — they are each service's own `*_PATH` value resolved against `WORKDIR` (`/app/apps/${SERVICE}`), and the spec derives them the same way rather than trusting this table.

**The registry host is the other value you must change.** Every application image is `us-central1-docker.pkg.dev/synapsedesk/services/<name>:<git-sha>`. The host and project are a stand-in for yours; the **tag is not** — it is the commit these manifests were written against, and CD rewrites it per deploy. `image-contract.spec.ts` refuses `:latest`, refuses a missing tag, and refuses an unqualified `synapsedesk/…` name (which would resolve to Docker Hub, where these images are not). A placeholder like `IMAGE_TAG` would have to be special-cased by that check, which is how a guard learns to ignore what it guards.

## Before the first apply

**The migrations exist** — `apps/*/prisma/migrations/0_init/migration.sql`, one per schema-owning service, generated as a diff against nothing:

```sh
# per service, from apps/<service>
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script \
  > prisma/migrations/0_init/migration.sql
```

`--to-schema`, **not** `--to-schema-datamodel` — the older spelling is what most tutorials still show and Prisma 7.9.1 removed it with an explicit error. `prisma.config.ts` already points `migrations.path` at `prisma/migrations`, which is why the file lands where the CLI looks for it.

**They deliberately contain none of the objects `schema-apply.ts` owns**, and that is structural rather than lucky: `schema.prisma` declares no `postgresqlExtensions`, so `migrate diff` cannot see `btree_gin`, and it has no syntax for a partial index at all. `schema-contract.spec.ts` check 4 keeps it that way — it derives the forbidden set from the seeders rather than carrying a list, and also refuses `CREATE EXTENSION`, `USING GIN` and any `WHERE`-clause index under a new name.

**Baseline every database that already has the tables.** A development database was built by `db push` and has no `_prisma_migrations` row, so `migrate deploy` would try to run `0_init` and fail on the first `CREATE TABLE`. Record it as applied instead — this runs no SQL:

```sh
# per service, from apps/<service>, once per EXISTING database
npx prisma migrate resolve --applied 0_init
```

A fresh production database needs none of this; it runs `0_init` for real.

**Seed the projection cursor, once per database — the other once-per-database step, and the other one nothing in the code will do for you.** `chunk-usage-projection` adds to counters over the interval since its cursor and refuses to invent one (`ProjectionCursorMissingError`), because seeding it means resetting every `document_chunks` row, and that `UPDATE` row-locks the table every upload writes to — not a thing the 02:00 job should do to live traffic. So it is an operator command, run against the ingestion database after the schema exists and before the first nightly run:

```sh
# from apps/ingestion-service, once per database
npm run projection:backfill
```

It resets in `PROJECTION_RESET_BATCH` batches, projects in `PROJECTION_BACKFILL_WINDOW_DAYS` windows from the oldest generation, and commits a cursor per window — interrupted, it resumes; complete, it is a no-op. Until it has run, that one step fails nightly and its `job_runs` heartbeat says why; the other daily steps are unaffected.

Then build the `migrate` image target, and only then apply.

```sh
docker build -f docker/node-service.Dockerfile --target migrate \
  --build-arg SERVICE=auth-service -t synapsedesk/auth-service-migrate .
```

That target is `FROM build` rather than `FROM runtime`, and it has to be: the Prisma CLI is a devDependency, `runtime` copies no `prisma/` directory, and `prisma.config.ts` loads through the TypeScript compiler against the root `tsconfig.json`. Three reasons, each fatal on its own. It costs 3.17 GB against `runtime`'s 1.01 GB and runs for seconds in a pod's init phase, which is where that difference is affordable and on a serving replica it is not.

## What the init container actually runs

Two steps, one container, `&&`-chained so a failed migration never reaches the second:

1. `prisma migrate deploy` — [ADR 0042](../docs/decisions/0042-schema-reaches-production-through-migrate-deploy.md).
2. `node dist/src/schema-apply.js` — the objects Prisma cannot express, which ran on every application boot until [ADR 0043](../docs/decisions/0043-the-cluster-shape.md) moved them here.

The second step is why the app pods no longer take a `ShareLock` on their own tables during startup. Measured: that lock queues behind any open write transaction (7.08 s behind an 8-second writer) and then blocks later writers behind it, and on the boot path the wait sat in front of readiness.

**Development runs the same step from the other side.** `npm run db:push` chains `db:schema` — the same entrypoint calling the same method — because `prisma db push` creates every table and none of the partial indexes, while the boot hook's `assertSchemaExists()` counts tables. Without that chaining a developer's database would look right and quietly permit what [ADR 0020](../docs/decisions/0020-email-uniqueness-is-per-tenant.md)'s partial index refuses.

## When a migration fails

`migrate deploy` runs in an init container, so a failure is `Init:Error` and **the pod never enters the Service endpoint list**. That is the safe direction and it is a property of the shape [ADR 0043](../docs/decisions/0043-the-cluster-shape.md) chose, not luck: a `Job` would have needed sequencing, and `migrate deploy` inside the app container would have failed a pod that was already receiving traffic.

**1. Look before you resolve.** Prisma writes the `_prisma_migrations` row _before_ applying and stamps `finished_at` after, so a crash in between leaves a row with `logs` and a null `finished_at` — and `migrate deploy` then refuses to run at all until that row is resolved. It does not retry and it does not skip. The refusal is the feature; the pod stays out of rotation while you decide.

```sql
SELECT migration_name, started_at, finished_at, rolled_back_at, logs
  FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;
```

**2. Then pick one, and the choice is about the SQL, not the row.**

```sh
# the statements did NOT land, or you undid them by hand
npx prisma migrate resolve --rolled-back 0_init

# the statements DID land and the crash was after them
npx prisma migrate resolve --applied 0_init
```

Getting this backwards is how a schema and its history stop agreeing — and nothing detects that afterwards, because both halves individually look fine. If the migration is not obviously all-or-nothing, read its SQL against the live catalogue before choosing.

**3. Rolling back is a code rollback, and only a code rollback.** Prisma generates no down-migrations. `kubectl rollout undo` restores a pod spec — which restores a real image because the tag is a commit sha rather than `:latest` — and the schema stays where it is. That is safe only while every previous image's expectations are a subset of the current schema, which is what [ADR 0044](../docs/decisions/0044-expand-and-contract-never-in-one-release.md) requires of every migration. Undoing a schema change is a new forward migration, written by hand.

## Inbound email — the cluster side

[`docs/reference/flows/inbound-email.md`](../docs/reference/flows/inbound-email.md) owns the Resend sequence (receiving domain, `npm run resend:provision`, per-tenant `organizations.inbound_token`, **MX last**). Three things have to be true here first.

**1. `INBOUND_EMAIL_SECRET` is one value in two places.** It is a key in the `api-gateway` and `notification-service` Secrets. `manifest-contract.spec.ts` asserts both carry it, and derives the list of holders from the services whose Joi schema names it — so a third consumer fails there rather than shipping without one. A mismatch is **silent**: `parseTicketReplyToken` returns `null` and every reply opens a **new ticket**. Rotate both at once; a partial rotation is worse than a wrong one, because half of it keeps working.

**2. The gateway Secret carries two more values, and neither is the sending key.** `RESEND_WEBHOOK_SECRET` is what `scripts/provision-resend.mjs` printed when it created the webhook (readable back with `--print-secret`); `RESEND_GATEWAY_API_KEY` is the key the gateway fetches inbound mail with — separate from notification-service's `RESEND_API_KEY` by name and by scope. `RESEND_WEBHOOK_URL` in the root `.env` must be the real Ingress host plus `/api/v1/webhooks/email/resend` before the webhook is created, because the webhook holds a URL.

**3. The inbound route needs nothing special from the Ingress, and this is confirmed rather than assumed.** `POST /api/v1/webhooks/email/resend` sits under the ordinary prefix and reaches the gateway through the one Ingress rule. It authenticates with the Standard Webhooks signature rather than a JWT (`resend-inbound.service.ts`), and the controller carries `@SkipThrottle()` — a retry burst is Resend doing its job; throttling it drops mail. Nothing to add.

## What this directory assumes already exists

`kubectl apply -f k8s/` is not the whole story. Four things are created elsewhere — Terraform, `gcloud`, or by hand — and nothing here makes one of them:

- **A namespace.** Nothing here sets one; apply into whichever you mean.
- **A CNI that actually enforces NetworkPolicy.** Several do not, and the API server accepts the object either way — so `policy/notification-egress.yaml` is **silently inert** on such a cluster, which is exactly the failure known gap #26 exists to describe. Verify enforcement rather than assuming it: with the policy applied, an egress to `10.0.0.1` from the notification pod must fail.
- **A `StorageClass`** the NATS and Qdrant `volumeClaimTemplates` can bind to. Without a default one, both StatefulSets sit `Pending` and nothing says why except the PVC's events.
- **An `ingress-nginx` controller.** [ADR 0043](../docs/decisions/0043-the-cluster-shape.md) chose it; no artifact here installs it. `ingress.yaml` names `ingressClassName: nginx` and an Ingress with no controller is an object with no effect.

## What is deliberately not here

- **The mail transport.** Resend receives and sends; the only artifacts here are the two Secrets' keys. The webhook itself is created by `scripts/provision-resend.mjs` against `RESEND_WEBHOOK_URL`, not by a manifest.
- **Prometheus.** `docker/prometheus/job-alerts.yml` is generated and tracked, and **development** scrapes it — `docker-compose.yml` carries one behind the `observability` profile. Nothing scrapes it _here_: these manifests only make scraping possible, by exposing 9464 on its own listener and setting `METRICS_HOST=0.0.0.0`. Whether the cluster gets a managed collector or an in-cluster stack is a decision with retention, alert routing and an on-call destination attached, and it has not been taken.
- **Postgres and Redis.** [ADR 0043](../docs/decisions/0043-the-cluster-shape.md) puts both on managed instances; their addresses arrive through `DATABASE_URL` and `REDIS_URL`, which are Secrets because they carry passwords.
- **The Firebase Storage emulator.** `docker-compose.yml` only.
