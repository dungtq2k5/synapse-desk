import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEDULED_JOBS } from './scheduler.config';

/**
 * The Prometheus staleness rules, closing the staleness-detection gap.
 *
 * **The alert file is GENERATED, and this test is what keeps that true.**
 * 's whole subject is seven jobs that existed and were never invoked, and
 * the reason it stayed invisible for two domains is that nothing held the list
 * of what SHOULD be running. A hand-maintained alert file recreates exactly
 * that hole one layer up: a job added to the scheduler and forgotten in the
 * rules is unmonitored, and it looks completely fine — an alert that does not
 * exist never fires.
 */
describe('Job staleness alerts', () => {
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

  it('3. **the BUILT lib the generator reads is in step with this source**', () => {
    // Guards the guard, and it is not hypothetical — it is how this suite came
    // to be red.
    //
    // Tests 1, 2 and 4 read `SCHEDULED_JOBS` through ts-jest, from SOURCE. The
    // generator imports `libs/common/dist/main.js`, which is a BUILD. When a job
    // is added and the lib is not rebuilt, the generator cannot see it — so test
    // 4 below regenerates stale content, finds it equal to the stale committed
    // file, and PASSES while the file is missing a job's alerts entirely.
    //
    // Asserted here rather than left to the reader: a vacuous guard is worse
    // than none, because it is evidence of a check that did not happen.
    // Read OUT OF PROCESS: importing the built `.js` from here would hand it to
    // ts-jest, which warns on every file and compiles a bundle this suite has no
    // reason to typecheck. Node reads its own output.
    const printed = execFileSync(
      process.execPath,
      [
        '-e',
        "import('./libs/common/dist/main.js').then((m) => " +
          'console.log(JSON.stringify(Object.values(m.SCHEDULED_JOBS))))',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );

    expect((JSON.parse(printed) as string[]).sort()).toEqual(
      Object.values(SCHEDULED_JOBS).sort(),
    );
  });

  it('4. **the committed file has not DRIFTED from the job list**', () => {
    // Regenerating and comparing, rather than spot-checking the contents. A
    // test that only asserts "every job appears" passes for a file that also
    // contains rules for three jobs that were deleted last quarter — and stale
    // alerts are how a team learns to ignore the channel.
    //
    // `--check`, so this WRITES NOTHING. Regenerating in place repaired the very
    // drift it exists to report: the suite went green on a second run, and a
    // stale `dist/` would have overwritten a correct file with fewer alerts.
    // A test must not edit the tree it is judging.
    expect(() =>
      execFileSync(
        process.execPath,
        [join(REPO_ROOT, 'scripts/generate-job-alerts.mjs'), '--check'],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    ).not.toThrow();
  });

  it('5. the threshold is TWICE the interval, matching the in-app verdict', () => {
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
