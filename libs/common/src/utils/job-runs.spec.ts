import {
  JobHealthService,
  JobRunRecorder,
  JobRunRow,
  JobRunStatusRow,
  JobRunStore,
  JobRunUpdate,
} from './job-runs';

/**
 * An in-memory `JobRunStore` — 20-doc §4.5 test 2.
 *
 * **The point of the interface.** The shared recorder is exercised here with no
 * Prisma client, no database and no Nest module: the three services differ only
 * in which delegate they bind, and that binding is what their own e2e suites
 * check. This file checks the behaviour, once, where it now lives.
 */
class FakeJobRunStore implements JobRunStore {
  readonly rows = new Map<string, JobRunStatusRow>();

  /** Set to make the next write throw, for the swallow test. */
  failNextWrite = false;

  upsert(args: {
    where: { jobName: string };
    create: JobRunRow;
    update: Partial<JobRunRow>;
  }): Promise<unknown> {
    this.guard();

    const existing = this.rows.get(args.where.jobName);

    if (existing) {
      Object.assign(existing, args.update);
    } else {
      this.rows.set(args.create.jobName, {
        jobName: args.create.jobName,
        lastStartedAt: args.create.lastStartedAt,
        lastSucceededAt: args.create.lastSucceededAt ?? null,
        lastDurationMs: args.create.lastDurationMs ?? null,
        lastError: args.create.lastError ?? null,
        consecutiveFailures: args.create.consecutiveFailures ?? 0,
      });
    }

    return Promise.resolve(undefined);
  }

  update(args: {
    where: { jobName: string };
    data: JobRunUpdate;
  }): Promise<unknown> {
    this.guard();

    const row = this.rows.get(args.where.jobName);
    if (!row) throw new Error(`no row for ${args.where.jobName}`);

    const { consecutiveFailures, ...rest } = args.data;
    Object.assign(row, rest);

    if (typeof consecutiveFailures === 'number') {
      row.consecutiveFailures = consecutiveFailures;
    } else if (consecutiveFailures) {
      row.consecutiveFailures += consecutiveFailures.increment;
    }

    return Promise.resolve(undefined);
  }

  findMany(): Promise<JobRunStatusRow[]> {
    return Promise.resolve(
      [...this.rows.values()].sort((a, b) =>
        a.jobName.localeCompare(b.jobName),
      ),
    );
  }

  private guard(): void {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('the heartbeat table is unreachable');
    }
  }
}

describe('the shared heartbeat — 20-doc §4.5', () => {
  let store: FakeJobRunStore;
  let recorder: JobRunRecorder;
  let health: JobHealthService;

  beforeEach(() => {
    store = new FakeJobRunStore();
    recorder = new JobRunRecorder(store);
    health = new JobHealthService(store);
  });

  describe('recording', () => {
    it('1. a successful run records a duration and clears the failure count', async () => {
      await expect(
        recorder.track('rollup', () => Promise.resolve(42)),
      ).resolves.toBe(42);

      const row = store.rows.get('rollup')!;
      expect(row.lastSucceededAt).not.toBeNull();
      expect(row.lastDurationMs).not.toBeNull();
      expect(row.consecutiveFailures).toBe(0);
      expect(row.lastError).toBeNull();
    });

    it('2. **a failure RETHROWS** — the heartbeat observes, it does not absorb', async () => {
      // A recorder that swallowed the job's error would leave BullMQ thinking
      // the run succeeded, so nothing would retry and the state would say
      // "completed" for a job that did nothing.
      await expect(
        recorder.track('rollup', () => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');
    });

    it('3. **a failure KEEPS the previous success**', async () => {
      // `lastSucceededAt` is what the staleness alert reads. Clearing it here
      // would turn "broken since Tuesday" into "never ran" and lose the only
      // piece of information worth having.
      await recorder.track('rollup', () => Promise.resolve(null));
      const succeededAt = store.rows.get('rollup')!.lastSucceededAt;

      await expect(
        recorder.track('rollup', () => Promise.reject(new Error('boom'))),
      ).rejects.toThrow();

      const row = store.rows.get('rollup')!;
      expect(row.lastSucceededAt).toEqual(succeededAt);
      expect(row.lastError).toContain('boom');
      expect(row.consecutiveFailures).toBe(1);
    });

    it('4. consecutive failures accumulate, then reset on success', async () => {
      // A count that only ever grows is how a job failing every night for a
      // month reads as one failure; one that never grows is how three nights
      // read as one.
      for (let attempt = 0; attempt < 3; attempt++) {
        await expect(
          recorder.track('rollup', () => Promise.reject(new Error('boom'))),
        ).rejects.toThrow();
      }
      expect(store.rows.get('rollup')!.consecutiveFailures).toBe(3);

      await recorder.track('rollup', () => Promise.resolve(null));

      expect(store.rows.get('rollup')!.consecutiveFailures).toBe(0);
      expect(store.rows.get('rollup')!.lastError).toBeNull();
    });

    it('5. a long error is TRUNCATED', async () => {
      // A driver stack trace is kilobytes and the first line is what anybody
      // reads — and this column is read by a dashboard, not a debugger.
      await expect(
        recorder.track('rollup', () =>
          Promise.reject(new Error('x'.repeat(5_000))),
        ),
      ).rejects.toThrow();

      expect(store.rows.get('rollup')!.lastError!.length).toBeLessThanOrEqual(
        1_000,
      );
    });

    it('6. **a heartbeat write failure does not fail the job**', async () => {
      // The run already happened and already did its work. Throwing here would
      // turn a bookkeeping outage into a lost night's rollup, inverting the
      // entire point of the table.
      store.failNextWrite = true;

      await expect(
        recorder.track('rollup', () => Promise.resolve('done')),
      ).resolves.toBe('done');
    });
  });

  describe('reading', () => {
    it('7. returns EVERY row, unjudged', async () => {
      // The staleness decision needs the list of jobs the build EXPECTS,
      // because a job that never ran has no row — so this must not filter.
      await recorder.track('b-job', () => Promise.resolve(null));
      await recorder.track('a-job', () => Promise.resolve(null));

      const rows = await health.list();

      expect(rows.map((row) => row.jobName)).toEqual(['a-job', 'b-job']);
    });

    it('8. an empty table is an empty list, not an error', async () => {
      // The state every service is in before its first run — and the one that
      // `checkStaleness` turns into `never-ran` for each expected job.
      await expect(health.list()).resolves.toEqual([]);
      await expect(health.heartbeats()).resolves.toEqual([]);
    });

    it('9. `heartbeats()` yields exactly what checkStaleness consumes', async () => {
      await recorder.track('rollup', () => Promise.resolve(null));

      const [heartbeat] = await health.heartbeats();

      expect(Object.keys(heartbeat).sort()).toEqual([
        'consecutiveFailures',
        'jobName',
        'lastSucceededAt',
      ]);
    });
  });
});
