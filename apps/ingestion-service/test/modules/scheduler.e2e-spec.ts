import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  repeatJobId,
  SCHEDULE_CRON,
  SCHEDULED_JOBS,
  SCHEDULER_QUEUE,
} from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { SchedulerProcessor } from '../../src/modules/scheduler/scheduler.processor';
import { SchedulerRegistrar } from '../../src/modules/scheduler/scheduler.registrar';
import { ChunkUsageProjection } from '../../src/modules/scheduled/chunk-usage.projection';
import { DiscardedDraftSweep } from '../../src/modules/scheduled/discarded-draft.sweep';
import { DocumentFlagService } from '../../src/modules/scheduled/document-flag.service';
import { QuotaReconciliationJob } from '../../src/modules/scheduled/quota-reconciliation.job';
import { AiGenerationRollupJob } from '../../src/modules/analytics/ai-generation-rollup.job';

/**
 * 20-doc §1, §2, §6 — the scheduler.
 *
 * **The layer whose absence was the entire bug.** Six jobs in this service were
 * written correctly, exported, imported into `AppModule`, and invoked by
 * nothing. Nothing failed and nothing alerted, because a job that never runs
 * produces zeros rather than errors — and a zero is a valid answer.
 *
 * So these tests are about the CALLER rather than the work: that the schedule
 * registers, that it does not duplicate itself across deploys, that the daily
 * sequence runs in the one order that is unrecoverable if reversed, and that a
 * failure part-way does not cost the rest of the night.
 */
describe('§1 The scheduler (e2e)', () => {
  let fx: E2eFixture;
  let processor: SchedulerProcessor;
  let registrar: SchedulerRegistrar;
  let queue: Queue;

  /** The private sequence methods, driven directly — the worker is stopped. */
  const runJob = (name: string) =>
    processor.process({ name, data: {} } as never);

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    processor = fx.moduleRef.get(SchedulerProcessor);
    registrar = fx.moduleRef.get(SchedulerRegistrar);
    queue = fx.moduleRef.get<Queue>(getQueueToken(SCHEDULER_QUEUE));
  });

  beforeEach(async () => {
    await fx.reset();
    jest.restoreAllMocks();
  });

  afterAll(() => fx.close());

  describe('registration', () => {
    it('1. registers both repeat entries on boot, with their cron patterns', async () => {
      await registrar.onApplicationBootstrap();

      const repeats = await queue.getJobSchedulers();
      const byName = new Map(repeats.map((r) => [r.name, r]));

      expect(byName.get(SCHEDULED_JOBS.LEDGER_HOURLY)?.pattern).toBe(
        SCHEDULE_CRON[SCHEDULED_JOBS.LEDGER_HOURLY],
      );
      expect(byName.get(SCHEDULED_JOBS.LEDGER_DAILY)?.pattern).toBe(
        SCHEDULE_CRON[SCHEDULED_JOBS.LEDGER_DAILY],
      );
    });

    it('2. **restarting does not create a duplicate schedule**', async () => {
      // The redeploy bug, and it compounds silently: without a stable `jobId`
      // every deploy adds another repeat entry for the same cron, so the job
      // begins running twice, then three times, then once per deploy this
      // month — with no error anywhere, because each run individually succeeds.
      await registrar.onApplicationBootstrap();
      await registrar.onApplicationBootstrap();
      await registrar.onApplicationBootstrap();

      const repeats = await queue.getJobSchedulers();

      expect(repeats).toHaveLength(2);
      // Keyed by the id we chose, not by a hash of the options — which is what
      // makes a CHANGED cron an update rather than a second schedule.
      expect(repeats.map((r) => r.key).sort()).toEqual(
        [
          repeatJobId(SCHEDULED_JOBS.LEDGER_DAILY),
          repeatJobId(SCHEDULED_JOBS.LEDGER_HOURLY),
        ].sort(),
      );
    });

    it('2b. **changing a cron REPLACES the schedule rather than adding one**', async () => {
      // The failure mode the explicit id buys. With a hash-derived key, editing
      // a pattern leaves the old entry live and adds a second — so the job runs
      // on both schedules, and nothing anywhere says so.
      await registrar.onApplicationBootstrap();

      await queue.upsertJobScheduler(
        repeatJobId(SCHEDULED_JOBS.LEDGER_DAILY),
        { pattern: '30 5 * * *' },
        { name: SCHEDULED_JOBS.LEDGER_DAILY, data: {} },
      );

      const repeats = await queue.getJobSchedulers();
      const daily = repeats.filter(
        (r) => r.key === repeatJobId(SCHEDULED_JOBS.LEDGER_DAILY),
      );

      expect(repeats).toHaveLength(2);
      expect(daily).toHaveLength(1);
      expect(daily[0].pattern).toBe('30 5 * * *');
    });

    it('3. **uses a job id BullMQ will accept** — no colons', async () => {
      // BullMQ uses `:` as its own Redis key delimiter and rejects a custom id
      // containing one. The failure surfaces as "the schedule silently did not
      // register", which is indistinguishable from never having written the
      // scheduler at all — the exact bug this file exists about.
      for (const name of Object.values(SCHEDULED_JOBS)) {
        expect(repeatJobId(name)).not.toContain(':');
      }

      await registrar.onApplicationBootstrap();
      expect(await queue.getJobSchedulers()).not.toHaveLength(0);
    });

    it('4. a Redis failure at registration does not stop the service booting', async () => {
      // A service that will not start because Redis blinked is a strictly
      // larger blast radius than one whose schedule is missing — and the
      // staleness alert is what catches the latter.
      jest
        .spyOn(queue, 'upsertJobScheduler')
        .mockRejectedValue(new Error('redis is unreachable'));

      await expect(registrar.onApplicationBootstrap()).resolves.toBeUndefined();
      // And nothing was registered — otherwise this would pass against a
      // registrar that quietly ignored the injected failure.
      jest.restoreAllMocks();
      expect(await queue.getJobSchedulers()).toHaveLength(0);
    });
  });

  describe('the daily SEQUENCE — the constraint that is unrecoverable if reversed', () => {
    it('5. **runs projection → rollup → flags, in that order**', async () => {
      // Not a preference. `ChunkUsageProjection` reads the retrieved/cited chunk
      // id arrays on `ai_generations`, which ledger retention will eventually
      // drop; anything scheduled after retention reads nothing, permanently.
      // And `UNRETRIEVED`/`UNCITED` are computed from the counters the
      // projection writes, so flags first are flags against yesterday.
      const order: string[] = [];

      jest
        .spyOn(fx.moduleRef.get(ChunkUsageProjection), 'project')
        .mockImplementation(() => {
          order.push('projection');

          return Promise.resolve(0);
        });
      jest
        .spyOn(fx.moduleRef.get(AiGenerationRollupJob), 'run')
        .mockImplementation(() => {
          order.push('rollup');

          return Promise.resolve({ tenants: 0, rows: 0 });
        });
      jest
        .spyOn(fx.moduleRef.get(DocumentFlagService), 'detect')
        .mockImplementation(() => {
          order.push('flags');

          return Promise.resolve(0);
        });

      await runJob(SCHEDULED_JOBS.LEDGER_DAILY);

      // `flags` may be absent when no tenant has documents; the ORDER of what
      // did run is the assertion.
      expect(order.slice(0, 2)).toEqual(['projection', 'rollup']);
      expect(order.indexOf('projection')).toBeLessThan(order.indexOf('rollup'));
    });

    it('6. **a step that throws does not prevent the ones after it**', async () => {
      // One bad tenant's projection must not cost that night's rollup as well.
      // A sequence that aborted on the first error would turn a small fault
      // into a missing day — and the next run only recomputes a trailing
      // window, so a long enough outage loses data for good.
      const rollup = jest
        .spyOn(fx.moduleRef.get(AiGenerationRollupJob), 'run')
        .mockResolvedValue({ tenants: 0, rows: 0 });

      jest
        .spyOn(fx.moduleRef.get(ChunkUsageProjection), 'project')
        .mockRejectedValue(new Error('projection exploded'));

      await expect(
        runJob(SCHEDULED_JOBS.LEDGER_DAILY),
      ).resolves.toBeUndefined();
      expect(rollup).toHaveBeenCalled();
    });

    it('7. asks the rollup for a TRAILING window, not just yesterday', async () => {
      // What makes ONE 02:00 UTC schedule correct for tenants in every
      // timezone: a tenant whose local day closes after 02:00 UTC is picked up
      // by the next run. Narrow this to a single day and the schedule silently
      // starts losing the last day for every tenant east of UTC.
      const rollup = jest
        .spyOn(fx.moduleRef.get(AiGenerationRollupJob), 'run')
        .mockResolvedValue({ tenants: 0, rows: 0 });
      jest
        .spyOn(fx.moduleRef.get(ChunkUsageProjection), 'project')
        .mockResolvedValue(0);

      await runJob(SCHEDULED_JOBS.LEDGER_DAILY);

      const [, days] = rollup.mock.calls[0];
      expect(days).toBeGreaterThan(1);
    });
  });

  describe('the hourly sequence', () => {
    it('8. sweeps discarded drafts, then reconciles quota', async () => {
      const sweep = jest
        .spyOn(fx.moduleRef.get(DiscardedDraftSweep), 'sweep')
        .mockResolvedValue(0);
      const reconcile = jest
        .spyOn(fx.moduleRef.get(QuotaReconciliationJob), 'reconcileAll')
        .mockResolvedValue(0);

      await runJob(SCHEDULED_JOBS.LEDGER_HOURLY);

      expect(sweep).toHaveBeenCalledTimes(1);
      expect(reconcile).toHaveBeenCalledTimes(1);
    });

    it('9. **calls reconcileAll with NO cycle argument** — 20-doc §3.1', async () => {
      // The signature is the fix. `reconcileAll(cycleStart)` applied one date to
      // every tenant, writing each corrected counter under a Redis key the gate
      // never reads — reconciliation that reported success and corrected
      // nothing. A scheduler passing "now" would have shipped exactly that.
      jest
        .spyOn(fx.moduleRef.get(DiscardedDraftSweep), 'sweep')
        .mockResolvedValue(0);
      const reconcile = jest
        .spyOn(fx.moduleRef.get(QuotaReconciliationJob), 'reconcileAll')
        .mockResolvedValue(0);

      await runJob(SCHEDULED_JOBS.LEDGER_HOURLY);

      expect(reconcile).toHaveBeenCalledWith();
    });

    it('10. a failing sweep does not prevent reconciliation', async () => {
      jest
        .spyOn(fx.moduleRef.get(DiscardedDraftSweep), 'sweep')
        .mockRejectedValue(new Error('sweep exploded'));
      const reconcile = jest
        .spyOn(fx.moduleRef.get(QuotaReconciliationJob), 'reconcileAll')
        .mockResolvedValue(0);

      await expect(
        runJob(SCHEDULED_JOBS.LEDGER_HOURLY),
      ).resolves.toBeUndefined();
      expect(reconcile).toHaveBeenCalled();
    });
  });

  describe('unknown job names', () => {
    it('11. an entry from an older deploy is ignored, not retried forever', async () => {
      // A repeat entry outlives the build that created it. Throwing here would
      // make BullMQ retry it with backoff indefinitely, burying the jobs that
      // do exist under a name nothing handles.
      const projection = jest.spyOn(
        fx.moduleRef.get(ChunkUsageProjection),
        'project',
      );

      await expect(runJob('ledger-weekly-from-2024')).resolves.toBeUndefined();
      expect(projection).not.toHaveBeenCalled();
    });
  });
});
