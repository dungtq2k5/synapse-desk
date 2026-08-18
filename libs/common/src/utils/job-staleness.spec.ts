import { checkStaleness, JobHeartbeat } from './job-staleness';
import { SCHEDULED_JOBS } from '../configs/scheduler.config';

/**
 * tests 1–3 — **alert on staleness, not on failure**.
 *
 * A failed job logs. A job that never ran logs nothing at all, which is exactly
 * what happened here: seven jobs with no scheduler, producing zeros that every
 * endpoint reported correctly and nothing complained about.
 *
 * So the condition has to fire for BOTH "it broke" and "it was never wired" —
 * indistinguishable from outside and equally bad — and the second is the one an
 * implementation gets wrong, because an absent row reads as "no evidence of
 * failure" when it means "no evidence of anything".
 */
describe('job staleness', () => {
  const NOW = new Date('2026-08-07T12:00:00.000Z');
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  const heartbeat = (overrides: Partial<JobHeartbeat> = {}): JobHeartbeat => ({
    jobName: SCHEDULED_JOBS.ANALYTICS_DAILY,
    lastSucceededAt: new Date(NOW.getTime() - HOUR),
    consecutiveFailures: 0,
    ...overrides,
  });

  it('1. a job that succeeded recently is healthy', () => {
    expect(
      checkStaleness([SCHEDULED_JOBS.ANALYTICS_DAILY], [heartbeat()], NOW),
    ).toEqual([]);
  });

  it('2. **a job with NO ROW is stale — the exact case that occurred**', () => {
    // `NULL` must not read as healthy. This is the whole bug: seven jobs with
    // no heartbeat, no error, no log line, and six endpoints answering zero.
    // An implementation that iterates over the ROWS IT FINDS reports nothing
    // wrong here, which is how a missing scheduler survives a review.
    const verdicts = checkStaleness([SCHEDULED_JOBS.ANALYTICS_DAILY], [], NOW);

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      jobName: SCHEDULED_JOBS.ANALYTICS_DAILY,
      reason: 'never-ran',
      lastSucceededAt: null,
    });
  });

  it('3. a row that has started but never SUCCEEDED is also never-ran', () => {
    // `last_started_at` set with `last_succeeded_at` null: a job that has been
    // failing since the day it was wired. It has a row, so a naive check finds
    // it and moves on.
    const verdicts = checkStaleness(
      [SCHEDULED_JOBS.ANALYTICS_DAILY],
      [heartbeat({ lastSucceededAt: null, consecutiveFailures: 9 })],
      NOW,
    );

    expect(verdicts[0].reason).toBe('never-ran');
  });

  it('4. **one missed tick does NOT alert; two do**', () => {
    // Twice the interval. A deploy, a slow night, or a retry that consumed the
    // window should not page anybody — an alert that cries wolf is one people
    // route to a folder.
    const oneMissed = checkStaleness(
      [SCHEDULED_JOBS.ANALYTICS_DAILY],
      [heartbeat({ lastSucceededAt: new Date(NOW.getTime() - 1.5 * DAY) })],
      NOW,
    );
    expect(oneMissed).toEqual([]);

    const twoMissed = checkStaleness(
      [SCHEDULED_JOBS.ANALYTICS_DAILY],
      [heartbeat({ lastSucceededAt: new Date(NOW.getTime() - 2.5 * DAY) })],
      NOW,
    );
    expect(twoMissed[0].reason).toBe('stale');
  });

  it('5. the hourly job is judged on an HOURLY interval, not a daily one', () => {
    // A shared threshold would let the hourly sweep be a day late before
    // anything noticed — by which point quota drift has had 24 hours to grow.
    const verdicts = checkStaleness(
      [SCHEDULED_JOBS.LEDGER_HOURLY],
      [
        heartbeat({
          jobName: SCHEDULED_JOBS.LEDGER_HOURLY,
          lastSucceededAt: new Date(NOW.getTime() - 5 * HOUR),
        }),
      ],
      NOW,
    );

    expect(verdicts[0].reason).toBe('stale');
  });

  it('6. **a failing job keeps its last success** — that is what staleness reads', () => {
    // Clearing `last_succeeded_at` on failure would turn
    // "broken since Tuesday" into "never ran" and lose the only information
    // worth having about how long this has been going on.
    const verdicts = checkStaleness(
      [SCHEDULED_JOBS.ANALYTICS_DAILY],
      [
        heartbeat({
          lastSucceededAt: new Date(NOW.getTime() - 3 * DAY),
          consecutiveFailures: 3,
        }),
      ],
      NOW,
    );

    expect(verdicts[0]).toMatchObject({
      reason: 'failing',
      consecutiveFailures: 3,
    });
    expect(verdicts[0].lastSucceededAt).toEqual(
      new Date(NOW.getTime() - 3 * DAY),
    );
  });

  it('7. distinguishes "broke" from "was never wired"', () => {
    // Both are equally bad and both must alert — but they point at different
    // places to look, so folding them into one reason costs whoever is paged
    // the first ten minutes of the investigation.
    const verdicts = checkStaleness(
      [SCHEDULED_JOBS.ANALYTICS_DAILY, SCHEDULED_JOBS.LEDGER_DAILY],
      [
        heartbeat({
          lastSucceededAt: new Date(NOW.getTime() - 3 * DAY),
          consecutiveFailures: 2,
        }),
      ],
      NOW,
    );

    expect(verdicts.map((v) => [v.jobName, v.reason])).toEqual([
      [SCHEDULED_JOBS.ANALYTICS_DAILY, 'failing'],
      [SCHEDULED_JOBS.LEDGER_DAILY, 'never-ran'],
    ]);
  });

  it('8. an unexpected heartbeat is ignored rather than reported healthy', () => {
    // A row from a job this build no longer schedules must not satisfy the
    // check for one it does — the caller passes what it EXPECTS, and only that
    // list can be reported on.
    const verdicts = checkStaleness(
      [SCHEDULED_JOBS.ANALYTICS_DAILY],
      [heartbeat({ jobName: 'some-retired-job' })],
      NOW,
    );

    expect(verdicts[0].reason).toBe('never-ran');
  });
});
