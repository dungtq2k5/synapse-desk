/**
 * The scheduler — 20-doc §1, §2.
 *
 * **The layer whose absence was the entire bug.** Seven background jobs were
 * written correctly — idempotent, windowed, per-tenant-aware, each tested in
 * isolation — and every one of them was invoked by nothing. Nothing failed and
 * nothing alerted, because a job that never runs produces zeros rather than
 * errors, and a zero is a valid answer.
 *
 * **BullMQ repeatable jobs rather than `@Cron`, and the reason is replicas.**
 * `@nestjs/schedule` runs in-process: with three pods, `@Cron('0 2 * * *')`
 * fires three times at 02:00 — three concurrent upsert sets racing on the same
 * `(organization_id, day)` rows, three sets of logs, and under a rolling deploy
 * it can be zero or four. These jobs are idempotent so nothing corrupts, which
 * is exactly why it would never have been noticed. A repeat entry lives in
 * Redis and is consumed by ONE worker, with retry and queryable state, and
 * costs no infrastructure that is not already running.
 *
 * **"Consumed by ONE worker" is correct for REPLICAS of a service and
 * catastrophic ACROSS services** — which is why {@link SCHEDULER_QUEUE} carries
 * the service name. Three ticket-service pods on one queue is the mechanism
 * working as designed. Three different services on one queue is the same
 * mechanism deleting work, because the winner of the race is whoever claims the
 * job, not whoever owns it.
 */

/**
 * One queue PER SERVICE — never one queue shared by all of them.
 *
 * **This was a bare `'scheduler'`, and it silently lost scheduled work.** Each
 * service registered only its own repeat entries and ran a worker on
 * *everyone's* queue. BullMQ hands a job to whichever worker claims it first,
 * and a worker cannot decline one it does not recognise — so `ledger-hourly`
 * arrived at ticket-service, hit its unknown-job branch, and that branch
 * RETURNED. BullMQ recorded success and advanced the schedule. With three
 * services up, roughly two thirds of every service's runs evaporated: no error,
 * no failed job, and the missing runs were the ones that correct drift.
 *
 * The design note above is the other half of why it survived review — it
 * reasons about replicas, where one-worker-per-queue is exactly right, and read
 * as a justification for sharing the name.
 *
 * A job can now only reach the service that owns it, by construction rather
 * than by every processor agreeing to be careful.
 *
 * **A HYPHEN, not a colon, and BullMQ enforces that** — `new Queue('scheduler:auth')`
 * throws `Queue name cannot contain :`, because `:` is its own Redis key
 * delimiter. It is the same constraint {@link SCHEDULED_JOBS} records for job
 * ids, and it applies to queue names too; the difference is that this one fails
 * at construction, so the service does not boot rather than misbehaving.
 *
 * The hyphen also makes the one-time cleanup below safe: `bull:scheduler:*`
 * matches the OLD shared queue's keys and not `bull:scheduler-auth:*`, so the
 * sweep cannot take the new queues with it.
 *
 * ---
 *
 * **Deploying this needs the old queue drained, in this order.** The repeat
 * entries under the old `scheduler` name survive the rename and keep producing
 * jobs into a queue no worker consumes, where they accumulate as waiting jobs
 * rather than being discarded:
 *
 *   1. Stop the old workers (the deploy does this).
 *   2. Remove the old repeat entries.
 *   3. New queues register on boot.
 *
 * Reverse 1 and 2 and the window between them is a growing backlog.
 *
 * `DEL bull:scheduler:*` is the sweep, and it is safe only because the new
 * names use a hyphen — see above. `queue.obliterate()` on the old name works
 * too and enumerates its own keys rather than globbing.
 */
export const SCHEDULER_QUEUE = {
  auth: 'scheduler-auth',
  ticket: 'scheduler-ticket',
  ingestion: 'scheduler-ingestion',
} as const;

export type SchedulerQueueName =
  (typeof SCHEDULER_QUEUE)[keyof typeof SCHEDULER_QUEUE];

/**
 * Job names — the string a repeat entry is registered under and the worker
 * switches on.
 *
 * **No colons.** BullMQ uses `:` as its own Redis key delimiter and rejects a
 * custom job id containing one, which is a failure that surfaces as "the
 * schedule silently did not register" — the same class of bug this whole
 * document is about.
 */
export const SCHEDULED_JOBS = {
  /**
   * ingestion-service, hourly. Draft outcomes, then quota drift.
   *
   * Hourly rather than daily because both correct a divergence that grows: an
   * unswept draft is a denominator that keeps overstating acceptance, and
   * counter drift is a gate charging against numbers nobody reconciled.
   */
  LEDGER_HOURLY: 'ledger-hourly',

  /**
   * ingestion-service, daily. **A SEQUENCE, not a set** — see `JOB_SEQUENCES`.
   */
  LEDGER_DAILY: 'ledger-daily',

  /** ticket-service, daily. The ticket and agent rollups. */
  ANALYTICS_DAILY: 'analytics-daily',

  /**
   * auth-service, hourly. Transitions expired invitations to EXPIRED.
   *
   * Beyond tidiness: `seatsInUse()` counts PENDING invitations as reserved
   * seats, so without this a tenant slowly runs out of seats nobody is using.
   */
  AUTH_HOURLY: 'auth-hourly',

  /** auth-service, daily. Prunes expired sessions, OTPs and reset tokens. */
  AUTH_DAILY: 'auth-daily',
} as const;

export type ScheduledJobName =
  (typeof SCHEDULED_JOBS)[keyof typeof SCHEDULED_JOBS];

/**
 * Cron expressions, in one readable place.
 *
 * **02:00 UTC for the daily jobs, one schedule for every timezone.** That is
 * only correct because both rollups recompute a TRAILING WINDOW rather than
 * yesterday alone: a tenant whose local day closes after 02:00 UTC is picked up
 * by the next run's window. Narrow the trailing window to one day and this
 * schedule silently starts losing the last day for every tenant east of UTC.
 */
export const SCHEDULE_CRON = {
  [SCHEDULED_JOBS.LEDGER_HOURLY]: '0 * * * *',
  [SCHEDULED_JOBS.LEDGER_DAILY]: '0 2 * * *',
  [SCHEDULED_JOBS.ANALYTICS_DAILY]: '0 2 * * *',
  [SCHEDULED_JOBS.AUTH_HOURLY]: '0 * * * *',
  [SCHEDULED_JOBS.AUTH_DAILY]: '0 3 * * *',
} as const satisfies Record<ScheduledJobName, string>;

/**
 * **The ordering constraints, as data.**
 *
 * Both entries below are CORRECTNESS constraints rather than scheduling
 * preferences, and both are unrecoverable if violated:
 *
 *   - `ChunkUsageProjection` before ledger retention (12-doc §4.1) — retention
 *     drops the arrays the projection reads.
 *   - `AiGenerationRollupJob` before ledger retention (19-doc §2.1) — the same
 *     arrays, the same permanent loss.
 *   - Document flags after the projection — `UNRETRIEVED`/`UNCITED` read the
 *     counters the projection writes, so flags computed first are flags
 *     computed against yesterday's numbers.
 *
 * **Encoded as one job calling them in sequence, never as two cron entries
 * fifteen minutes apart.** That alternative works until the first job takes
 * sixteen minutes, and then it fails by deleting data the second had not read
 * — silently, and with no way back, because the inputs are gone.
 */
export const JOB_SEQUENCES = {
  [SCHEDULED_JOBS.LEDGER_DAILY]: [
    'chunk-usage-projection',
    'ai-generation-rollup',
    'document-flags',
    // Retention belongs here, LAST, when it is built. Anywhere else in this
    // list destroys the inputs of whatever follows it.
  ],
  [SCHEDULED_JOBS.LEDGER_HOURLY]: ['discarded-draft-sweep', 'quota-reconcile'],
  [SCHEDULED_JOBS.ANALYTICS_DAILY]: ['ticket-rollup'],
  [SCHEDULED_JOBS.AUTH_HOURLY]: ['invitations-expiry'],
  [SCHEDULED_JOBS.AUTH_DAILY]: ['expired-records'],
} as const;

/**
 * How many days each daily rollup recomputes.
 *
 * Wider than one day on purpose — see `SCHEDULE_CRON`. It is also what makes a
 * missed run self-healing: a service down at 02:00 catches up the next night
 * rather than leaving a permanent hole.
 */
export const ROLLUP_TRAILING_DAYS = 3;

/**
 * A repeat entry's stable `jobId`.
 *
 * **Stable so a redeploy REPLACES the schedule rather than adding a second
 * one.** Without it every deploy leaves another repeat entry behind and the job
 * quietly starts running twice, then three times — the same trap
 * `notifications.event_id` solves for NATS, arriving somewhere else.
 */
export function repeatJobId(name: ScheduledJobName): string {
  return `repeat-${name}`;
}
