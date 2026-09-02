/**
 * @file The scheduler
 *
 * Background jobs run as BullMQ repeatable jobs rather than `@Cron`, so a
 * service with three replicas fires each schedule once rather than three times.
 */

/**
 * The queue each service schedules on. One per service — see the warning below.
 *
 * @example
 * BullModule.registerQueue({ name: SCHEDULER_QUEUE.auth });
 */
// **Never share one queue between services.** BullMQ hands a job to whichever
// worker claims it first and a worker cannot decline one it does not recognise,
// so a shared name lets `ledger-hourly` arrive at ticket-service, hit its
// unknown-job branch, return, and be recorded as a success. Replicas of ONE
// service on one queue is the mechanism working as designed; two services on
// one queue silently deletes work.
//
// Hyphen, not colon: `new Queue('scheduler:auth')` throws, because `:` is
// BullMQ's own Redis key delimiter.
export const SCHEDULER_QUEUE = {
  auth: 'scheduler-auth',
  ticket: 'scheduler-ticket',
  ingestion: 'scheduler-ingestion',
  notification: 'scheduler-notification',
} as const;

export type SchedulerQueueName =
  (typeof SCHEDULER_QUEUE)[keyof typeof SCHEDULER_QUEUE];

/** Which service owns a queue — the key side of {@link SCHEDULER_QUEUE}. */
export type SchedulerService = keyof typeof SCHEDULER_QUEUE;

/**
 * Job names — the string a repeat entry is registered under and the worker
 * switches on.
 */
// No colons: BullMQ rejects a custom job id containing one, and the failure
// looks like "the schedule silently did not register".
export const SCHEDULED_JOBS = {
  /** ingestion-service, hourly. Draft outcomes, then quota drift. */
  LEDGER_HOURLY: 'ledger-hourly',

  /** ingestion-service, daily. Runs an ordered sequence — see {@link JOB_SEQUENCES}. */
  LEDGER_DAILY: 'ledger-daily',

  /** ticket-service, daily. The ticket and agent rollups. */
  ANALYTICS_DAILY: 'analytics-daily',

  /**
   * auth-service, hourly. Transitions expired invitations to EXPIRED.
   *
   * `seatsInUse()` counts PENDING invitations as reserved seats, so this is
   * what stops a tenant running out of seats nobody is using.
   */
  AUTH_HOURLY: 'auth-hourly',

  /** auth-service, daily. Prunes expired sessions, OTPs and reset tokens. */
  AUTH_DAILY: 'auth-daily',

  /**
   * auth-service, hourly. Reads active subscriptions from Stripe and stores the
   * revenue snapshot `GET /platform/finance` serves.
   *
   * **Its own job rather than a step on `AUTH_HOURLY`, and the heartbeat is
   * what decides it.** `JobRunRecorder.track` records one row per JOB, not per
   * step, so a Stripe outage folded into `AUTH_HOURLY` would report invitation
   * expiry as failing — a job that ran perfectly, red in `/platform/jobs`
   * because something unrelated shares its heartbeat.
   *
   * Hourly because the endpoint reads the snapshot and never Stripe: freshness
   * is bounded by this cadence, and `subscriptions.list` pages at 100 so the
   * read grows with tenant count.
   */
  BILLING_SNAPSHOT: 'billing-snapshot',

  /**
   * ingestion-service, every ten minutes. Re-queues jobs the queue lost or
   * deferred.
   *
   * Not a step on `LEDGER_HOURLY`, and cadence is what decides it: the symptom
   * is "I uploaded a document and nothing happened", normal ingestion is
   * seconds to minutes, and an hour of `PENDING` is indistinguishable from
   * broken.
   */
  INGESTION_RECONCILE: 'ingestion-reconcile',

  /**
   * ingestion-service, hourly. Detects and repairs chunk scope drift.
   *
   * `ScopeWriterService.apply()` writes two stores that cannot share a
   * transaction. Its ordering makes a partial failure safe in the direction
   * that matters, and nothing has ever checked that the second write landed —
   * so every failure mode ends at a durable, silent inconsistency.
   *
   * **Not a step on `LEDGER_HOURLY`**, on the same test `INGESTION_RECONCILE`
   * applies above: `JOB_SEQUENCES` is for steps whose ORDER is a correctness
   * constraint, and scope reconciliation has no ordering relationship to draft
   * outcomes or quota drift.
   *
   * **Hourly rather than every ten minutes**, and cadence is again what decides
   * it — the cron literal is spelled out rather than quoted here because a
   * `*` followed by `/` ends this comment block. Drift
   * has no user reporting it — that is the whole problem — and the repair is a
   * Qdrant write per affected document. Hourly bounds the exposure window
   * without running a write-heavy sweep 144 times a day to usually find
   * nothing.
   */
  SCOPE_RECONCILE: 'scope-reconcile',

  /**
   * notification-service, daily. Prunes `webhook_deliveries` older than
   * `WEBHOOK_RETENTION_DAYS`.
   *
   * The table is one row per event per endpoint and nothing else bounds it —
   * unlike `notification_deliveries`, which is bounded by notifications, which
   * are bounded by events that involve people. This job is also what made
   * notification-service a scheduled-jobs service at all: the fourth
   * `job_runs` table, the fourth `/platform/jobs` leg, the fourth queue.
   */
  WEBHOOK_RETENTION: 'webhook-retention',
} as const;

export type ScheduledJobName =
  (typeof SCHEDULED_JOBS)[keyof typeof SCHEDULED_JOBS];

/** Cron expression per job. Daily jobs run at 02:00 UTC for every tenant. */
// One UTC schedule is only correct because the rollups recompute a trailing
// window — see ROLLUP_TRAILING_DAYS. Narrow that to one day and every tenant
// east of UTC silently loses its last day.
export const SCHEDULE_CRON = {
  [SCHEDULED_JOBS.LEDGER_HOURLY]: '0 * * * *',
  [SCHEDULED_JOBS.LEDGER_DAILY]: '0 2 * * *',
  [SCHEDULED_JOBS.ANALYTICS_DAILY]: '0 2 * * *',
  [SCHEDULED_JOBS.AUTH_HOURLY]: '0 * * * *',
  [SCHEDULED_JOBS.AUTH_DAILY]: '0 3 * * *',
  [SCHEDULED_JOBS.BILLING_SNAPSHOT]: '0 * * * *',
  [SCHEDULED_JOBS.INGESTION_RECONCILE]: '*/10 * * * *',
  [SCHEDULED_JOBS.SCOPE_RECONCILE]: '0 * * * *',
  [SCHEDULED_JOBS.WEBHOOK_RETENTION]: '0 4 * * *',
} as const satisfies Record<ScheduledJobName, string>;

/**
 * The steps each scheduled job runs, in order.
 *
 * One job calling them in sequence — never two cron entries minutes apart,
 * which breaks as soon as the first step runs long.
 */
// **The order is a correctness constraint, and violating it is unrecoverable.**
// Retention drops the arrays that ChunkUsageProjection and
// AiGenerationRollupJob read, and document flags read the
// counters the projection writes.
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
  [SCHEDULED_JOBS.BILLING_SNAPSHOT]: ['billing-snapshot'],
  [SCHEDULED_JOBS.INGESTION_RECONCILE]: ['ingestion-reconcile'],
  [SCHEDULED_JOBS.SCOPE_RECONCILE]: ['scope-reconcile'],
  [SCHEDULED_JOBS.WEBHOOK_RETENTION]: ['webhook-retention'],
} as const satisfies Record<ScheduledJobName, readonly string[]>;

/**
 * How many days each daily rollup recomputes.
 *
 * Wider than one day so a missed run self-heals on the next night, and so a
 * tenant whose local day closes after 02:00 UTC is still covered.
 */
export const ROLLUP_TRAILING_DAYS = 3;

/**
 * Which service registers and runs each schedule.
 *
 * **Exhaustive, and the registrars iterate it** — that pairing is the point.
 * Registering used to be two literal `register()` calls per service, so adding
 * a job to `SCHEDULED_JOBS` gave you a name that `/platform/jobs` expected,
 * that `checkStaleness` monitored, and that BullMQ had never heard of. A job
 * that never runs, produced by the one edit nothing checked — the same shape as
 * the seven uncalled jobs the scheduler work started from.
 *
 * The gateway's `JOB_OWNER` derives from this rather than repeating it, so
 * "which service" is decided once.
 */
export const JOB_SERVICE = {
  [SCHEDULED_JOBS.LEDGER_HOURLY]: 'ingestion',
  [SCHEDULED_JOBS.LEDGER_DAILY]: 'ingestion',
  [SCHEDULED_JOBS.ANALYTICS_DAILY]: 'ticket',
  [SCHEDULED_JOBS.AUTH_HOURLY]: 'auth',
  [SCHEDULED_JOBS.AUTH_DAILY]: 'auth',
  [SCHEDULED_JOBS.BILLING_SNAPSHOT]: 'auth',
  [SCHEDULED_JOBS.INGESTION_RECONCILE]: 'ingestion',
  [SCHEDULED_JOBS.SCOPE_RECONCILE]: 'ingestion',
  [SCHEDULED_JOBS.WEBHOOK_RETENTION]: 'notification',
} as const satisfies Record<ScheduledJobName, SchedulerService>;

/**
 * Every job one service owns, for its registrar to walk.
 *
 * @example
 * for (const name of jobsOwnedBy('ingestion')) await this.register(name);
 */
export function jobsOwnedBy(
  service: SchedulerService,
): readonly ScheduledJobName[] {
  return Object.values(SCHEDULED_JOBS).filter(
    (name) => JOB_SERVICE[name] === service,
  );
}

/**
 * A repeat entry's stable `jobId`.
 *
 * Pass it when registering a repeatable job so a redeploy replaces the schedule
 * instead of adding a second one that runs alongside it.
 *
 * @example
 * await queue.add(name, {}, { repeat: { pattern }, jobId: repeatJobId(name) });
 */
export function repeatJobId(name: ScheduledJobName): string {
  return `repeat-${name}`;
}
