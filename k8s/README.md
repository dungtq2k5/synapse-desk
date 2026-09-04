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

The source is each service's **`.env.example`**, active and commented lines alike. `# METRICS_HOST = 127.0.0.1` is not a disabled setting — it is how this repository documents a default without setting it, and the cluster is the one place those defaults are wrong. A generator that read only active lines would drop `METRICS_HOST`, every `REDIS_DB` and rag-service's `GRPC_PORT`, which is
exactly the set a pod overrides.

It is deliberately **not** `scripts/generate-docker-env.mjs`'s input. That script reads the developer's untracked `.env` and says so — _"the output may hold real credentials"_. These files are tracked. What transfers is its substitution table, not its source.

## What you must supply

Nothing in `generated/` carries a real value.

- **`REPLACE_ME`** in a ConfigMap is a per-deployment value: `CORS`, `APP_WEB_URL`, the SMTP host, the storage bucket, and so on.
- **`*.secret.example.yaml`** is a key list with empty values. Create the real Secret out of band — `kubectl create secret generic`, a sealed-secret controller, or your platform's secret manager. Never commit one.
- **File Secrets** are separate from the variable Secrets above, because they are mounted rather than injected:

  | Secret                       | contents                                                  | mounted at                                              |
  | :--------------------------- | :-------------------------------------------------------- | :------------------------------------------------------ |
  | `api-gateway-jwt-public`     | `jwt-access.pub`, `jwt-2fa.pub`                           | `/app/apps/api-gateway/secrets/`                        |
  | `auth-service-files`         | `jwt-access.key`, `jwt-2fa.key`, `serviceAccountKey.json` | `/app/apps/auth-service/secrets/`                       |
  | `storage-service-files`      | `serviceAccountKey.json`                                  | `/app/apps/storage-service/serviceAccountKey.json`      |
  | `notification-service-files` | `serviceAccountKey.json` (optional — FCM)                 | `/app/apps/notification-service/serviceAccountKey.json` |

  **Three Firebase service accounts, three variable names, two directory conventions.** auth's is under `secrets/`; storage's and notification's are at the package root. The paths above are not a convention to remember — they are each service's own `*_PATH` value resolved against `WORKDIR` (`/app/apps/${SERVICE}`), and the spec derives them the same way rather than trusting this table.

## Before the first apply

**Migrations do not exist yet.** `apps/*/prisma/` holds `schema.prisma` and no `migrations/` directory, so the `migrate` init containers will exit non-zero and their pods will never start. [ADR 0042](../docs/decisions/0042-schema-reaches-production-through-migrate-deploy.md) records this as a consequence rather than a surprise: _"Migrations are generated and committed before the mechanism can be used."_ Generate and commit them, build the `migrate` image target, and only then apply.

```sh
docker build -f docker/node-service.Dockerfile --target migrate \
  --build-arg SERVICE=auth-service -t synapsedesk/auth-service-migrate .
```

That target is `FROM build` rather than `FROM runtime`, and it has to be: the Prisma CLI is a devDependency, `runtime` copies no `prisma/` directory, and `prisma.config.ts` loads through the TypeScript compiler against the root `tsconfig.json`. Three reasons, each fatal on its own. It costs 3.17 GB against `runtime`'s 1.01 GB and runs for seconds in a pod's init phase, which is where that difference is affordable and on a serving replica it is not.

## What the init container actually runs

Two steps, one container, `&&`-chained so a failed migration never reaches the second:

1. `prisma migrate deploy` — [ADR 0042](../docs/decisions/0042-schema-reaches-production-through-migrate-deploy.md).
2. `node dist/src/schema-apply.js` — the twenty-six objects Prisma cannot express, which ran on every application boot until [ADR 0043](../docs/decisions/0043-the-cluster-shape.md) moved them here.

The second step is why the app pods no longer take a `ShareLock` on their own tables during startup. Measured: that lock queues behind any open write transaction (7.08 s behind an 8-second writer) and then blocks later writers behind it, and on the boot path the wait sat in front of readiness.

**Development runs the same step from the other side.** `npm run db:push` chains `db:schema` — the same entrypoint calling the same method — because `prisma db push` creates every table and none of the partial indexes, while the boot hook's `assertSchemaExists()` counts tables. Without that chaining a developer's database would look right and quietly permit what [ADR 0020](../docs/decisions/0020-email-uniqueness-is-per-tenant.md)'s partial index refuses.

## What is deliberately not here

- **`workers/email-inbound`** — a Cloudflare Worker, deployed with `wrangler`.
- **Prometheus.** `docker/prometheus/job-alerts.yml` is generated and tracked and nothing scrapes it. These manifests only make scraping possible, by exposing 9464 on its own listener and setting `METRICS_HOST=0.0.0.0`.
- **Postgres and Redis.** [ADR 0043](../docs/decisions/0043-the-cluster-shape.md) puts both on managed instances; their addresses arrive through `DATABASE_URL` and `REDIS_URL`, which are Secrets because they carry passwords.
- **The Firebase Storage emulator.** `docker-compose.yml` only.
