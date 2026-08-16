import { SCHEDULE_CRON, ScheduledJobName } from '../configs/scheduler.config';

/** What a heartbeat row looks like to the staleness check. */
export type JobHeartbeat = {
  jobName: string;
  lastSucceededAt: Date | null;
  consecutiveFailures: number;
};

/** Why a job is considered unhealthy — or `null` when it is fine. */
export type StalenessVerdict = {
  jobName: string;
  /** `never` is a DIFFERENT finding from `stale`; see `checkStaleness`. */
  reason: 'never-ran' | 'stale' | 'failing';
  /** Absent for `never-ran`, which is the point of the distinction. */
  lastSucceededAt: Date | null;
  consecutiveFailures: number;
};

/**
 * How long after its expected interval a job counts as stale.
 *
 * **Twice the interval**, so a single missed tick — a deploy, a slow night, a
 * retry that took the whole window — does not page anybody, while two in a row
 * does.
 */
const STALENESS_FACTOR = 2;

/** Rough interval per cron pattern, in ms. Only the ones this system uses. */
const INTERVAL_MS: Record<string, number> = {
  '0 * * * *': 60 * 60 * 1000,
  '0 2 * * *': 24 * 60 * 60 * 1000,
  '0 3 * * *': 24 * 60 * 60 * 1000,
};

/** The fallback when a pattern is not in the table above — a day. */
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function expectedIntervalMs(name: ScheduledJobName): number {
  return INTERVAL_MS[SCHEDULE_CRON[name]] ?? DEFAULT_INTERVAL_MS;
}

/**
 * **Alerts on STALENESS, not on failure**
 *
 * A failed job logs. A job that never ran logs nothing at all, which is exactly
 * the case that occurred here: seven jobs with no scheduler, producing zeros
 * that every endpoint reported correctly. So the condition is
 * `last_succeeded_at < now - 2 × interval`, which fires for both "it broke" and
 * "it was never wired" — indistinguishable from outside, and equally bad.
 *
 * **A job with NO ROW is stale, not healthy.** This is the exact case that
 * occurred, and the one an implementation is most likely to get wrong: an
 * absent row and a `NULL` timestamp both read as "no evidence of failure",
 * which is the opposite of what they mean. `expected` is passed in rather than
 * derived from the rows, so a job that has never run once cannot be missed by
 * a check that only looks at what it finds.
 */
export function checkStaleness(
  expected: readonly ScheduledJobName[],
  heartbeats: readonly JobHeartbeat[],
  now: Date = new Date(),
): StalenessVerdict[] {
  const byName = new Map(heartbeats.map((row) => [row.jobName, row]));

  return expected.flatMap((name): StalenessVerdict[] => {
    const row = byName.get(name);

    // No row at all. Reported as its own reason rather than folded into
    // `stale`, because the two need different responses: "never ran" is a
    // wiring bug and "stale" is an outage.
    if (!row || !row.lastSucceededAt) {
      return [
        {
          jobName: name,
          reason: 'never-ran',
          lastSucceededAt: null,
          consecutiveFailures: row?.consecutiveFailures ?? 0,
        },
      ];
    }

    const age = now.getTime() - row.lastSucceededAt.getTime();

    if (age > expectedIntervalMs(name) * STALENESS_FACTOR) {
      return [
        {
          jobName: name,
          // `failing` when we know WHY — it ran and threw. Same urgency, but
          // it points at a different place to look.
          reason: row.consecutiveFailures > 0 ? 'failing' : 'stale',
          lastSucceededAt: row.lastSucceededAt,
          consecutiveFailures: row.consecutiveFailures,
        },
      ];
    }

    return [];
  });
}
