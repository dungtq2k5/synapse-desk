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

## Eleven of the twelve steps are idempotent

`chunk-usage-projection` is the exception, and it is not a redelivery hazard —
it accumulates on the **normal** daily path.

It writes `SET retrieval_count = c.retrieval_count + usage.hits` (and the same
shape for `citation_count`). Its window is `trailingWindow(now, ROLLUP_TRAILING_DAYS)`,
`ROLLUP_TRAILING_DAYS` is 3, and `trailingWindow` subtracts `days + 1` — **a
four-day window, recomputed every day, with nothing resetting the counters.**
Each generation's hits are added by roughly four successive runs.

**The codebase already draws the distinction, one step later in the same
sequence.** `AiGenerationRollupJob` uses delete-then-insert *"so a re-run
recomputes rather than accumulates"*, because *"two rollups that behave
differently under re-run is exactly the kind of difference nobody remembers when
debugging a doubled number."*

`trailingWindow`'s own defence — a half-open interval, so consecutive runs
neither skip a row nor count one twice — holds for **adjacent** windows. This one
overlaps on purpose, justified by *"a window an hour too wide re-computes a day
that was already correct"*: true for delete-then-insert, false for `+=`. One
helper, two jobs, opposite re-run semantics, and the safety argument written for
the other one.

**What it does and does not affect:** bucketing is safe — `neverRetrieved` and
`retrievedNeverCited` classify on zero thresholds, as do the document flags. The
**absolute counts** in `analyticsDocuments` are inflated, and **`mostCited` is
systematically biased against recent documents**: one cited yesterday has had one
pass, one cited last week has had four.

This is a code defect, not a documentation one — tracked as **known-gaps row
29**, which carries the options and the closing condition.

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

**Nothing scrapes it yet.** There is no Prometheus in `docker-compose.yml` and
none in `k8s/`. The metric is exported and the rules exist; the collector that
would fire them does not.

---

## Edge cases

| Situation | What happens | Why |
| :---- | :---- | :---- |
| **Three replicas** | one schedule | Stable `jobId`; the repeat lives in Redis, not in the process |
| **Deploy during a run** | the job is redelivered | BullMQ redelivery — but see below: **eleven of the twelve steps are idempotent, not all twelve** |
| **A step throws** | later steps in that sequence do not run | The order is a data dependency, so continuing would read inputs that were never written |
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
| A job runs but its later steps do not | an earlier step threw; the sequence stops rather than continuing on missing inputs |
| `mostCited` favours old documents, or counts look too high | `chunk-usage-projection` accumulates over an overlapping window — see above |
| Alerts never fire | nothing scrapes the metric yet — the rules file has no reader |
| Alerts are a job short | regenerate, and build the lib first |
