/**
 * The scheduler — 20-doc §1, §2.
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
} as const;

export type SchedulerQueueName =
  (typeof SCHEDULER_QUEUE)[keyof typeof SCHEDULER_QUEUE];

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
} as const satisfies Record<ScheduledJobName, string>;

/**
 * The steps each scheduled job runs, in order.
 *
 * One job calling them in sequence — never two cron entries minutes apart,
 * which breaks as soon as the first step runs long.
 */
// **The order is a correctness constraint, and violating it is unrecoverable.**
// Retention drops the arrays that ChunkUsageProjection (12-doc §4.1) and
// AiGenerationRollupJob (19-doc §2.1) read, and document flags read the
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
} as const;

/**
 * How many days each daily rollup recomputes.
 *
 * Wider than one day so a missed run self-heals on the next night, and so a
 * tenant whose local day closes after 02:00 UTC is still covered.
 */
export const ROLLUP_TRAILING_DAYS = 3;

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
