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
import { TicketRollupJob } from '../../src/modules/analytics/ticket-rollup.job';

/**
 * 20-doc §1 — the clock `TicketRollupJob` never had.
 *
 * Without it, `ticket_daily_stats` and `agent_daily_stats` were never written
 * and **all six analytics endpoints returned zeros** — correctly, from empty
 * tables, which is exactly why every test passed.
 */
describe('§1 The scheduler (e2e)', () => {
  let fx: E2eFixture;
  let processor: SchedulerProcessor;
  let registrar: SchedulerRegistrar;
  let queue: Queue;

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
    // Repeat entries live in Redis, not Postgres, so `reset()` does not touch
    // them — and a leftover from the previous test would make the duplicate
    // assertions meaningless.
    for (const scheduler of await queue.getJobSchedulers()) {
      await queue.removeJobScheduler(scheduler.key);
    }
  });

  afterAll(() => fx.close());

  it('1. registers the daily rollup on boot', async () => {
    await registrar.onApplicationBootstrap();

    const [scheduler] = await queue.getJobSchedulers();

    expect(scheduler.name).toBe(SCHEDULED_JOBS.ANALYTICS_DAILY);
    expect(scheduler.pattern).toBe(
      SCHEDULE_CRON[SCHEDULED_JOBS.ANALYTICS_DAILY],
    );
    expect(scheduler.key).toBe(repeatJobId(SCHEDULED_JOBS.ANALYTICS_DAILY));
  });

  it('2. **restarting does not create a duplicate schedule**', async () => {
    // The redeploy bug: without a stable id every deploy adds another entry
    // for the same cron, and the rollup begins running twice — with no error
    // anywhere, because each run individually succeeds and the job is
    // idempotent. Idempotency makes this survivable, which is precisely why it
    // would never be noticed.
    await registrar.onApplicationBootstrap();
    await registrar.onApplicationBootstrap();
    await registrar.onApplicationBootstrap();

    expect(await queue.getJobSchedulers()).toHaveLength(1);
  });

  it('3. **the tick actually calls the rollup** — the whole point', async () => {
    // The one assertion that would have failed before 20-doc: the job existed
    // and nothing invoked it.
    const run = jest
      .spyOn(fx.moduleRef.get(TicketRollupJob), 'run')
      .mockResolvedValue({ tenants: 0, ticketRows: 0, agentRows: 0 });

    await runJob(SCHEDULED_JOBS.ANALYTICS_DAILY);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('4. asks for a TRAILING window, so one UTC schedule serves every timezone', async () => {
    // A tenant whose local day closes after 02:00 UTC is picked up by the next
    // run's window. Narrow this to a single day and the schedule silently
    // starts losing the last day for every tenant east of UTC — which is most
    // of them, and which nothing would report.
    const run = jest
      .spyOn(fx.moduleRef.get(TicketRollupJob), 'run')
      .mockResolvedValue({ tenants: 0, ticketRows: 0, agentRows: 0 });

    await runJob(SCHEDULED_JOBS.ANALYTICS_DAILY);

    const [, days] = run.mock.calls[0];
    expect(days).toBeGreaterThan(1);
  });

  it('5. a failing run RETHROWS, so BullMQ retries and the state records it', async () => {
    // Unlike ingestion-service's multi-step sequence, there is nothing after
    // this to protect — so the honest thing is to fail loudly. A swallowed
    // error here would be a job whose state says "completed" having done
    // nothing, which is the failure mode 20-doc is about.
    jest
      .spyOn(fx.moduleRef.get(TicketRollupJob), 'run')
      .mockRejectedValue(new Error('rollup exploded'));

    await expect(runJob(SCHEDULED_JOBS.ANALYTICS_DAILY)).rejects.toThrow(
      'rollup exploded',
    );
  });

  it('6. an entry from an older deploy is ignored, not retried forever', async () => {
    const run = jest.spyOn(fx.moduleRef.get(TicketRollupJob), 'run');

    await expect(runJob('analytics-weekly-from-2024')).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  /**
   * 20-doc §4.1 — the heartbeat.
   *
   * The jobs not running was not the deepest problem. **Nothing anywhere could
   * tell you they were not running**, and a job that never runs logs nothing at
   * all. These rows are what a staleness alert reads.
   */
  describe('the heartbeat', () => {
    it('7. a successful run records last_succeeded_at', async () => {
      jest
        .spyOn(fx.moduleRef.get(TicketRollupJob), 'run')
        .mockResolvedValue({ tenants: 1, ticketRows: 2, agentRows: 1 });

      await runJob(SCHEDULED_JOBS.ANALYTICS_DAILY);

      const row = await fx.prisma.jobRun.findUniqueOrThrow({
        where: { jobName: SCHEDULED_JOBS.ANALYTICS_DAILY },
      });
      expect(row.lastSucceededAt).not.toBeNull();
      expect(row.consecutiveFailures).toBe(0);
      expect(row.lastError).toBeNull();
      expect(row.lastDurationMs).not.toBeNull();
    });

    it('8. **a failure records the error and KEEPS the previous success**', async () => {
      // The previous success is what the staleness alert reads. Clearing it
      // here would turn "broken since Tuesday" into "never ran" and lose the
      // one piece of information worth having — 20-doc §4 test 2.
      const rollup = jest.spyOn(fx.moduleRef.get(TicketRollupJob), 'run');

      rollup.mockResolvedValue({ tenants: 0, ticketRows: 0, agentRows: 0 });
      await runJob(SCHEDULED_JOBS.ANALYTICS_DAILY);

      const succeeded = (
        await fx.prisma.jobRun.findUniqueOrThrow({
          where: { jobName: SCHEDULED_JOBS.ANALYTICS_DAILY },
        })
      ).lastSucceededAt;

      rollup.mockRejectedValue(new Error('rollup exploded'));
      await expect(runJob(SCHEDULED_JOBS.ANALYTICS_DAILY)).rejects.toThrow();

      const after = await fx.prisma.jobRun.findUniqueOrThrow({
        where: { jobName: SCHEDULED_JOBS.ANALYTICS_DAILY },
      });
      expect(after.lastSucceededAt).toEqual(succeeded);
      expect(after.lastError).toContain('rollup exploded');
      expect(after.consecutiveFailures).toBe(1);
    });

    it('9. consecutive failures ACCUMULATE, then reset on success', async () => {
      // A count that only ever grows is how a job failing every night for a
      // month reads as one failure; a count that never grows is how three
      // nights read as one.
      const rollup = jest
        .spyOn(fx.moduleRef.get(TicketRollupJob), 'run')
        .mockRejectedValue(new Error('nope'));

      await expect(runJob(SCHEDULED_JOBS.ANALYTICS_DAILY)).rejects.toThrow();
      await expect(runJob(SCHEDULED_JOBS.ANALYTICS_DAILY)).rejects.toThrow();

      expect(
        (
          await fx.prisma.jobRun.findUniqueOrThrow({
            where: { jobName: SCHEDULED_JOBS.ANALYTICS_DAILY },
          })
        ).consecutiveFailures,
      ).toBe(2);

      rollup.mockResolvedValue({ tenants: 0, ticketRows: 0, agentRows: 0 });
      await runJob(SCHEDULED_JOBS.ANALYTICS_DAILY);

      const recovered = await fx.prisma.jobRun.findUniqueOrThrow({
        where: { jobName: SCHEDULED_JOBS.ANALYTICS_DAILY },
      });
      expect(recovered.consecutiveFailures).toBe(0);
      expect(recovered.lastError).toBeNull();
    });

    it('10. **a heartbeat write failure does not fail the job**', async () => {
      // The run already happened and already did its work. Throwing here would
      // turn a bookkeeping outage into a lost night's rollup, inverting the
      // entire point of the table.
      jest
        .spyOn(fx.moduleRef.get(TicketRollupJob), 'run')
        .mockResolvedValue({ tenants: 0, ticketRows: 0, agentRows: 0 });
      jest
        .spyOn(fx.prisma.jobRun, 'upsert')
        .mockRejectedValue(new Error('heartbeat table is gone'));

      await expect(
        runJob(SCHEDULED_JOBS.ANALYTICS_DAILY),
      ).resolves.toBeUndefined();
    });
  });
});
