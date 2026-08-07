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
 */

/** The queue every scheduled job in a service shares. */
export const SCHEDULER_QUEUE = 'scheduler';

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
