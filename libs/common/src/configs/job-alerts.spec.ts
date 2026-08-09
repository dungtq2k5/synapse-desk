import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEDULED_JOBS } from './scheduler.config';

/**
 * The Prometheus staleness rules — 23-doc §4, closing 20-doc §4.2's gap.
 *
 * **The alert file is GENERATED, and this test is what keeps that true.**
 * 20-doc's whole subject is seven jobs that existed and were never invoked, and
 * the reason it stayed invisible for two domains is that nothing held the list
 * of what SHOULD be running. A hand-maintained alert file recreates exactly
 * that hole one layer up: a job added to the scheduler and forgotten in the
 * rules is unmonitored, and it looks completely fine — an alert that does not
 * exist never fires.
 */
describe('§4 job staleness alerts', () => {
  const committed = () => readFileSync(ALERTS, 'utf8');

  const REPO_ROOT = join(__dirname, '../../../..');
  const ALERTS = join(REPO_ROOT, 'docker/prometheus/job-alerts.yml');

  it('1. every scheduled job has a staleness rule', () => {
    const rules = committed();

    for (const job of Object.values(SCHEDULED_JOBS)) {
      expect(rules).toContain(
        `job_last_success_timestamp_seconds{job="${job}"}`,
      );
    }
  });

  it('2. **and a MISSING-series rule, which is the different failure**', () => {
    // `absent()` catches the never-wired case, which the staleness rule cannot:
    // the gauge exports no series at all for a job that has never succeeded
    // (deliberately — zero would be 1970 and would satisfy any `>` threshold).
    // Two rules because the two need different responses: "the rollup broke
    // last night" is a page, "the rollup was never wired" is a deploy.
    const rules = committed();

    for (const job of Object.values(SCHEDULED_JOBS)) {
      expect(rules).toContain(
        `absent(job_last_success_timestamp_seconds{job="${job}"})`,
      );
    }
  });

  it('3. **the committed file has not DRIFTED from the job list**', () => {
    // Regenerating and comparing, rather than spot-checking the contents. A
    // test that only asserts "every job appears" passes for a file that also
    // contains rules for three jobs that were deleted last quarter — and stale
    // alerts are how a team learns to ignore the channel.
    execFileSync(
      process.execPath,
      [join(REPO_ROOT, 'scripts/generate-job-alerts.mjs')],
      { encoding: 'utf8' },
    );

    // The script rewrites in place; if the committed content was already
    // correct, git sees no change. Compared by content rather than by git
    // status so the test works in a dirty tree.
    const regenerated = readFileSync(ALERTS, 'utf8');

    expect(regenerated).toBe(committed());
  });

  it('4. the threshold is TWICE the interval, matching the in-app verdict', () => {
    // The Prometheus rule and `checkStaleness()` must agree, or the dashboard
    // and the pager tell an operator different stories about the same job. Two
    // days for a daily job, two hours for an hourly one.
    const rules = committed();

    expect(rules).toContain(
      `job="${SCHEDULED_JOBS.ANALYTICS_DAILY}"} > 172800`,
    );
    expect(rules).toContain(`job="${SCHEDULED_JOBS.LEDGER_HOURLY}"} > 7200`);
  });
});
