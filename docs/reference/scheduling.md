# Scheduled jobs

The nine jobs, what each runs, where it runs, and how you know it stopped.
An **axis**, not a flow — several flows depend on these and none of them owns
the schedule.

The decision behind the mechanism is
[ADR 0003](../decisions/0003-bullmq-over-nest-cron.md): repeats on BullMQ, never
`@Cron`.

---

## The nine

| Job | Cron | Service | Steps, in order |
| :---- | :---- | :---- | :---- |
| `LEDGER_HOURLY` | `0 * * * *` | ingestion | `discarded-draft-sweep`, `quota-reconcile` |
| `LEDGER_DAILY` | `0 2 * * *` | ingestion | `chunk-usage-projection`, `ai-generation-rollup`, `document-flags` |
| `ANALYTICS_DAILY` | `0 2 * * *` | ticket | `ticket-rollup` |
| `AUTH_HOURLY` | `0 * * * *` | auth | `invitations-expiry` |
| `AUTH_DAILY` | `0 3 * * *` | auth | `expired-records` |
| `BILLING_SNAPSHOT` | `0 * * * *` | auth | `billing-snapshot` |
| `INGESTION_RECONCILE` | `*/10 * * * *` | ingestion | `ingestion-reconcile` |
| `SCOPE_RECONCILE` | `0 * * * *` | ingestion | `scope-reconcile` |
| `WEBHOOK_RETENTION` | `0 4 * * *` | notification | `webhook-retention` |

`SCHEDULE_CRON`, `JOB_SEQUENCES` and `JOB_SERVICE` are three records over one
key set, each `satisfies Record<ScheduledJobName, …>` — so adding a job without
a cron, a sequence or an owner is a compile error rather than a job that never
runs.

**`LEDGER_HOURLY` writes no rollup.** It sweeps discarded drafts and reconciles
the quota counter. The `ai-generation-rollup` is a `LEDGER_DAILY` step — reading
"hourly ledger" as "spend figures refresh hourly" is the mistake this table
exists to prevent.

**`LEDGER_DAILY` and `ANALYTICS_DAILY` run at the same minute**, in different
services. A divergence between the two legs of an analytics figure is therefore
one of them *failing*, not one of them lagging.

---

## Step order is a correctness constraint

Inside `LEDGER_DAILY` the order is not a preference:

> Retention drops the arrays that `ChunkUsageProjection` and
> `AiGenerationRollupJob` read, and document flags read the counters the
> projection writes.

Which is why the sequence carries an instruction for a job that does not exist
yet — *"Retention belongs here, LAST, when it is built. Anywhere else in this
list destroys the inputs of whatever follows it."*

**Retention is not built.** No retention job appears among the nine. Anything
that describes raw rows as being retention-rolled is describing the plan, not
today.

---

## All twelve steps are re-run safe, by two different mechanisms

`ai-generation-rollup` deletes and re-inserts its interval, so recomputing a
day it already had is free — which is why it runs over a deliberately wide
`trailingWindow(now, ROLLUP_TRAILING_DAYS)` and a missed night self-heals.

`chunk-usage-projection` **adds** to `document_chunks.retrieval_count` /
`citation_count`, so it cannot recompute; it takes a **cursor** instead.
`project(until)` reads `projection_cursors` for its lower bound and writes the
new bound last, inside the same transaction as the counters, so every
generation is counted by exactly one run. `until` lags `now` by
`PROJECTION_LAG_MS` so a row committed a moment after the statement began is
picked up next night rather than skipped forever — the one subtlety a cursor
has that a window did not.

**It refuses to run without a cursor.** Seeding one means resetting every chunk
counter, and that `UPDATE` row-locks the table every upload writes to, which is
not something the 02:00 job should do to a live system. The step fails with
`ProjectionCursorMissingError` until the operator runs, once per database:

```sh
npm run projection:backfill -w @synapsedesk/ingestion-service
```

It resets in `PROJECTION_RESET_BATCH` batches, projects in
`PROJECTION_BACKFILL_WINDOW_DAYS` windows from the oldest generation, and
commits a cursor per window — interrupted, it resumes; complete, it is a no-op.

The read side (`ai-analytics.service.ts`) has no date predicate: the counters
are a lifetime total **since the document's last reindex**, because
`writeChunkRows` deletes and recreates chunk rows and old generations then name
ids that no longer exist.

---

## Why BullMQ repeats and not `@Cron`

`@nestjs/schedule` runs the callback **in every replica**. Three pods means three
executions of a daily rollup, which for an idempotent job is waste and for a
non-idempotent one is corruption.

A BullMQ repeat with a **stable `jobId`** is one schedule in Redis however many
processes register it. That is what makes `replicas: 2` safe without any
leader-election machinery, and it is why `scheduler.registrar.ts` treats the
stable id as *"the whole trick"* — without one, every deploy adds another repeat
entry for the same cron and the job quietly begins running twice.

Repeat entries live in Redis and **outlive the process**, which is why the e2e
fixtures obliterate their own queues at teardown: a leftover schedule is executed
by the next suite that boots a worker on that queue name.

---

## How you know one stopped

Each job writes a heartbeat on success. The gateway exports
`job_last_success_timestamp_seconds` per job, and
`docker/prometheus/job-alerts.yml` alerts on staleness against each job's own
cadence — a `*/10` job and a daily one cannot share one threshold.

**That file is generated**, from `SCHEDULED_JOBS`:

```sh
npm run build -w @synapsedesk/common && node scripts/generate-job-alerts.mjs
```

The build comes first because the generator reads the **built** lib; a stale one
silently emits the old job list. Adding a member to `SCHEDULED_JOBS` leaves the
alert file a job short until it is regenerated.

**Development has a reader; the cluster does not.** `docker-compose.yml`
carries a Prometheus behind the `observability` profile — opt-in, so it is not
in the default `up` set — which mounts `docker/prometheus/` and evaluates
these rules:

```sh
docker compose --profile observability up -d prometheus   # localhost:9090
docker compose --profile observability down               # a bare `down` leaves it running
```

It needs `METRICS_HOST = 0.0.0.0` in `apps/api-gateway/.env`: the listener
defaults to loopback, so a container scraping the host otherwise finds nothing
and the target reads `DOWN`.

**`k8s/` has none**, deliberately — see `k8s/README.md`'s *What is
deliberately not here*. Production collection is a decision about retention
and on-call routing rather than a manifest, and it belongs to whoever has an
on-call to route to.

---

## Edge cases

| Situation | What happens | Why |
| :---- | :---- | :---- |
| **Three replicas** | one schedule | Stable `jobId`; the repeat lives in Redis, not in the process |
| **Deploy during a run** | the job is redelivered | BullMQ redelivery — safe: the rollup recomputes, the projection resumes from its cursor |
| **A step throws** | **later steps still run** — `step()` catches and logs, it does not rethrow | One bad tenant must not cost the night's rollup. The cost is that `document-flags` may compute against counters the projection did not write this run — stale, not wrong, and the next run closes the gap |
| **No projection cursor** | `chunk-usage-projection` fails every night with `ProjectionCursorMissingError`; the other steps run | Run `projection:backfill` once for that database — see above |
| **Redis flushed** | every repeat entry is gone until a process re-registers | Boot re-registers; a flush between deploys is a gap nothing reports |
| **A job is added** | compile error until cron, sequence and owner exist | Three `satisfies Record<…>` over one key set |
| **A job is added, alerts not regenerated** | it runs, unalerted | The generator is manual — see above |

---

## When it misbehaves

| Symptom | Look at |
| :---- | :---- |
| A rollup stopped updating | `job_runs` for that job, then whether its repeat entry still exists in Redis |
| A job ran twice | a second repeat entry — usually a deploy that changed the `jobId` |
| A daily figure is stale but its sibling is fresh | both dailies run at `0 2 * * *`, so this is a failure, not a lag |
| A step's heartbeat is stale while its siblings are fresh | that step threw; the others ran anyway — read its `job_runs.last_error` |
| `chunk-usage-projection` fails nightly with `ProjectionCursorMissingError` | the database was never backfilled — run `projection:backfill` once |
| Alerts never fire | is Prometheus running (`--profile observability`)? Is the target `UP` on `/targets` — if `DOWN`, `METRICS_HOST` is loopback. Does `/rules` show 18? A `rule_files` path that matches nothing loads zero rules and logs success |
| Alerts are a job short | regenerate, and build the lib first |
