# 0043 — The cluster shape: one Postgres instance, an initContainer, and `ingress-nginx`

**Status:** accepted · **Code:** `k8s/`, `scripts/generate-k8s-config.mjs`, `apps/*/src/schema-apply.ts`, `libs/common/src/configs/manifest-contract.spec.ts` · **Closes:** ADR 0042's _"where the step runs"_

## Decision

Three things at once, because each of them was being decided by default and the
defaults disagreed with each other.

**1. One managed Postgres instance with four databases**, not four instances and
not four in-cluster StatefulSets. `synapsedesk_auth`, `_ticket`, `_ingestion`
and `_notification` on one host, reached as four `DATABASE_URL`s.

[ADR 0022](./0022-no-cross-service-fks.md) is what makes it safe: a reference to
another service's row is a plain id validated over gRPC, never a foreign key.
The services already cannot join across each other, so the isolation that
matters is enforced in the schema rather than by the process boundary. Four
instances buys blast-radius isolation this system does not currently need, at
four times the patching, backup and cost.

**One managed Redis, one logical database.** `@socket.io/redis-adapter` needs a
single pub/sub namespace across gateway replicas, which rules out splitting by
service. And the `REDIS_DB` 3/4/5 and `/15` URL-suffix split that exists in the
repository is a **test** arrangement — it keeps suites off each other's keys and
lives only in `.env.test`. Every `.env.example` is database 0. Production does
not inherit a split it never had.

**NATS and Qdrant stay in-cluster**, as StatefulSets with PersistentVolumeClaims
rather than `emptyDir`. Known gap #14's third sighting is a JetStream durable
that survived a restart and blocked an unrelated suite; that persistence is the
behaviour we want in production, and it needs real storage.

**2. `prisma migrate deploy` AND the schema objects run in one `initContainer`**,
on each Deployment that owns a Prisma schema — auth, ticket, ingestion,
notification. Not a `Job`, and not two containers.

ADR 0042 named the ordering as the constraint: the step must complete before any
replica serves. An initContainer gets that from the kubelet for free — the pod
cannot start its app container until the init container exits 0 — with no
sync-wave tooling and no chance of a Deployment rolling ahead of its `Job`.
`migrate deploy` is idempotent and takes Prisma's own advisory lock, so the N
concurrent runs a multi-replica rollout produces serialise and the losers no-op.

The three Deployments with no Prisma schema — api-gateway, storage-service,
rag-service — get no init container, because there is nothing for it to do.

**The twenty-four objects Prisma cannot express moved here too**, out of the
application boot hook and into `src/schema-apply.ts`, which the same container
runs immediately after the migration. The reason is measured and is not the one
the first draft of this decision gave:

```text
no-op CREATE INDEX IF NOT EXISTS, table held by an 8-second writer
  lock requested:     ShareLock on the table   (granted=false, waiting)
  DDL wall time:      7.08 s
  concurrent SELECT:  0.04 s   — unblocked
  later writer:       4.03 s   — queued behind the DDL
```

`ShareLock`, not `AccessExclusiveLock`; writers blocked, not readers; and the
cost when uncontended is under a millisecond. What makes it worth moving is
none of those — it is _where the wait lands_. `ShareLock` queues behind any open
write transaction and then holds the head of the queue, so on the boot path a
pod was slow to start **because of production write traffic** and made that
traffic slower while it waited, with readiness gated behind it. In an init
container the identical wait happens before the pod is in the endpoint list.

**The boot hook keeps `assertSchemaExists()`, and that is not a leftover.**
[ADR 0042](./0042-schema-reaches-production-through-migrate-deploy.md)'s finding
was a schema step that could be skipped without anything noticing; a boot path
that fell silent when the step moved would recreate it exactly. A service
started outside Kubernetes gets no init container at all.

**And the development path gets the same step, which is the half that is easy
to miss.** `assertSchemaExists()` counts TABLES, and `prisma db push` creates
every table while creating none of the partial indexes or CHECK constraints — so
a developer would get a database that boots, serves, and silently permits the
duplicate signup [ADR 0020](./0020-email-uniqueness-is-per-tenant.md)'s partial
index exists to refuse, with nothing red. `npm run db:push` therefore chains
`db:schema`, which runs the same entrypoint against the same method. Two
environments, two callers, one list — [ADR 0039](./0039-the-seeder-ddl-block-is-the-list.md).

**3. `ingress-nginx` answers the proxying half of the ingress requirement.
`helmet` is the other half and belongs in the application.**

One controller plus one `Ingress` routing `/` to the api-gateway Service. Not a
hand-written `nginx.conf` in front of the cluster: that is a second reverse
proxy doing what the Ingress already does, and two places to configure CORS,
timeouts and upgrade headers is the same "two lists is two chances" hazard
`secure-gateway.decorator.ts` names about its own CORS.

## Why

Parts 1 and 2 carry their reasons inline, beside each choice, because each is
argued against its own specific alternative — [ADR 0022](./0022-no-cross-service-fks.md)
for the single instance; the kubelet's ordering and the measured lock for the
init container. What part 3 needed room for is why `ingress-nginx` and not the
alternatives.

### Why not the other ingress candidates

- **GKE native Ingress** (`gce`) provisions a Google L7 load balancer that
  carries WebSockets, but closes an idle upgraded connection at a 30-second
  backend timeout; raising it needs a `BackendConfig` CRD, a GKE-specific object
  to learn for one setting.
- **Gateway API** is where Kubernetes ingress is going and is probably the right
  answer in a year. Today it is a second set of CRDs for a system with one HTTP
  entry point.

## The security-header half is not closed by this, and that is the point of writing it down

`docs/tech-stack-spec.md` §"Ingress & Proxy" reads _"Reverse proxy, SSL
termination, strict Content Security Policy (CSP) headers, custom error
pages."_ The Ingress takes the first two. **Measured: there is no `helmet` and
no `contentSecurityPolicy` anywhere in this repository** — CORS was built and
the security-header half never was.

That half belongs in `main.ts`, not in the proxy: `helmet` is one middleware, it
versions with the code that decides what a page may load, and it survives a
change of ingress controller. Recording it here is what stops the requirement
being ticked off on half its meaning.

## What this does not decide

- **Whether the schema objects eventually become migration SQL.** They are one
  method called from two places now, which is a smaller thing than twenty-four
  statements spread across migration files — but it also means `migrate deploy`
  alone does not produce a complete schema, and a future operator reading
  Prisma's `_prisma_migrations` table will not see them. Left open.
- **Whether `helmet` ships with a strict or a permissive CSP.** Recorded as
  open, not answered.
- **Where the container images are built and pushed.** CI builds and tests; it
  does not publish. That is still a phase of its own.

## Consequences

- **`trust proxy` stays at 1.** `main.ts` sets a HOP COUNT and its comment
  already says _"Behind both an ALB and Nginx it must be 2"_. One
  `ingress-nginx` in front is exactly one hop, so the existing literal is
  correct for this decision and would be wrong for a shape that fronts the
  controller with a second proxy. `req.ip` feeds `device_sessions.ip_address`,
  the throttler's tracker and the audit log.
- **The database name becomes the discriminator**, which is a third address
  shape. `generate-docker-env.mjs`'s substitution table has two — distinct host
  ports (5432–5435) and identical in-network ports — and neither is "one host,
  one port, four database names". The generator that writes cluster config
  carries all three.
- **`DATABASE_URL` and `REDIS_URL` are Secrets, not ConfigMap entries**, because
  they carry passwords. The four-databases shape therefore lands on the Secret
  path.
