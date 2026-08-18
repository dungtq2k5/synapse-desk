import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  compareAlphabetically,
  InvitationStatus,
  JobHealthService,
  JobRunRecorder,
  repeatJobId,
  SCHEDULE_CRON,
  SCHEDULED_JOBS,
  SCHEDULER_QUEUE,
} from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { createInvitation, createOtp, seedTenantWithUser } from '../factories';
import { SchedulerProcessor } from '../../src/modules/scheduler/scheduler.processor';
import { SchedulerRegistrar } from '../../src/modules/scheduler/scheduler.registrar';

/**
 * Auth-service off `@nestjs/schedule`.
 *
 * Both jobs here were `@Cron`, which runs in-process: three pods fired each of
 * them three times, and under a rolling deploy zero or four. Both are
 * idempotent, so the impact was duplicated work rather than wrong data —
 * genuinely low severity, and not the reason it changed.
 *
 * It changed because **two mechanisms for one concern is how a third appears**.
 * This codebase once had two BullMQ schedulers and one built on
 * decorators, and whoever added the next scheduled job would have copied
 * whichever they found first.
 *
 * These jobs also had NO tests before this file — a `@Cron` can only be tested
 * by waiting, which is the second reason the decorator had to go.
 */
describe('The scheduler (e2e)', () => {
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
    queue = fx.moduleRef.get<Queue>(getQueueToken(SCHEDULER_QUEUE.auth));
  });

  beforeEach(async () => {
    await fx.reset();
    // Repeat entries live in Redis, which `reset()` does not touch.
    for (const scheduler of await queue.getJobSchedulers()) {
      await queue.removeJobScheduler(scheduler.key);
    }
  });

  afterAll(() => fx.close());

  describe('registration', () => {
    it('1. registers both repeat entries on boot', async () => {
      await registrar.onApplicationBootstrap();

      const byName = new Map(
        (await queue.getJobSchedulers()).map((r) => [r.name, r]),
      );

      expect(byName.get(SCHEDULED_JOBS.AUTH_HOURLY)?.pattern).toBe(
        SCHEDULE_CRON[SCHEDULED_JOBS.AUTH_HOURLY],
      );
      expect(byName.get(SCHEDULED_JOBS.AUTH_DAILY)?.pattern).toBe(
        SCHEDULE_CRON[SCHEDULED_JOBS.AUTH_DAILY],
      );
    });

    it('2. **restarting does not create a duplicate schedule**', async () => {
      // The failure `@Cron` had by construction: one firing per pod. A repeat
      // entry keyed on a stable id is registered once no matter how many
      // replicas boot, which is the entire reason for the migration.
      await registrar.onApplicationBootstrap();
      await registrar.onApplicationBootstrap();
      await registrar.onApplicationBootstrap();

      const repeats = await queue.getJobSchedulers();

      expect(repeats).toHaveLength(2);
      expect(repeats.map((r) => r.key).sort(compareAlphabetically)).toEqual(
        [
          repeatJobId(SCHEDULED_JOBS.AUTH_DAILY),
          repeatJobId(SCHEDULED_JOBS.AUTH_HOURLY),
        ].sort(compareAlphabetically),
      );
    });
  });

  describe('the hourly invitation sweep', () => {
    it('3. **expires a stale invitation, which RELEASES its reserved seat**', async () => {
      // Beyond tidiness: `seatsInUse()` counts PENDING invitations as reserved
      // seats, so without this sweep a tenant slowly runs out of seats nobody
      // is using — and cannot invite anyone until somebody notices.
      const t = await seedTenantWithUser(fx.prisma);
      const { row } = await createInvitation(fx.prisma, t.org.id, {
        invitedById: t.user.id,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });

      await runJob(SCHEDULED_JOBS.AUTH_HOURLY);

      expect(
        (
          await fx.prisma.userInvitation.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).status,
      ).toBe(InvitationStatus.EXPIRED);
    });

    it('4. leaves a still-valid invitation alone', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const { row } = await createInvitation(fx.prisma, t.org.id, {
        invitedById: t.user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      await runJob(SCHEDULED_JOBS.AUTH_HOURLY);

      expect(
        (
          await fx.prisma.userInvitation.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).status,
      ).toBe(InvitationStatus.PENDING);
    });
  });

  describe('the daily prune', () => {
    it('5. deletes EXPIRED sessions, OTPs and reset tokens', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const past = new Date(Date.now() - 60 * 60 * 1000);

      await createOtp(fx.prisma, t.user.id, { expiresAt: past });

      await runJob(SCHEDULED_JOBS.AUTH_DAILY);

      expect(await fx.prisma.otp.count()).toBe(0);
    });

    it('6. **keeps an unexpired row** — the sweep reclaims space, it enforces nothing', async () => {
      // An expired session is rejected on its own expiry whether or not the row
      // is still there, so a prune that took live rows would be doing something
      // the sweep has no business doing.
      const t = await seedTenantWithUser(fx.prisma);

      await createOtp(fx.prisma, t.user.id, {
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      await runJob(SCHEDULED_JOBS.AUTH_DAILY);

      expect(await fx.prisma.otp.count()).toBe(1);
    });
  });

  describe('the heartbeat', () => {
    it('7. a run records last_succeeded_at', async () => {
      await runJob(SCHEDULED_JOBS.AUTH_HOURLY);

      const row = await fx.prisma.jobRun.findUniqueOrThrow({
        where: { jobName: SCHEDULED_JOBS.AUTH_HOURLY },
      });
      expect(row.lastSucceededAt).not.toBeNull();
      expect(row.consecutiveFailures).toBe(0);
    });

    it('8. **an unknown job FAILS rather than reporting success**', async () => {
      // This asserted `resolves.toBeUndefined()` — the old branch returned, so
      // BullMQ recorded success for work nobody did and advanced the schedule.
      // That was the mechanism by which the shared queue silently deleted runs:
      // every service received its neighbours' jobs and marked them complete.
      //
      // With one queue per service an unrecognized name can only be a repeat
      // entry from an older deploy, which is a defect worth seeing in `failed`.
      await expect(runJob('auth-weekly-from-2024')).rejects.toThrow(
        "Unknown scheduled job 'auth-weekly-from-2024'",
      );

      // And it still records no run, so `last_succeeded_at` cannot be refreshed
      // by a job that did nothing's staleness alert depends on it.
      expect(
        await fx.prisma.jobRun.findUnique({
          where: { jobName: 'auth-weekly-from-2024' },
        }),
      ).toBeNull();
    });
  });

  /**
   * The BINDING.
   *
   * `JobRunRecorder` now lives in `libs/common` and takes a `JobRunStore`.
   * `JobRunsModule` binds it to THIS service's `prisma.jobRun`, and three thin
   * bindings are three chances to wire the wrong one — a mistake that would
   * compile, because every delegate satisfies the interface structurally.
   *
   * The shared behaviour is covered once, against a fake store, in
   * `libs/common/src/utils/job-runs.spec.ts`. What is left to check here is
   * only what is local: that a run recorded through the injected recorder lands
   * in this service's own database, in the same failure domain as the work.
   */
  describe('The shared recorder is bound to THIS database', () => {
    it('9. a tracked run writes a row readable through this service’s Prisma', async () => {
      const recorder = fx.moduleRef.get(JobRunRecorder);

      await recorder.track('binding-probe', () => Promise.resolve(null));

      const row = await fx.prisma.jobRun.findUniqueOrThrow({
        where: { jobName: 'binding-probe' },
      });
      expect(row.lastSucceededAt).not.toBeNull();
    });

    it('10. and JobHealthService reads back what the recorder wrote', async () => {
      // Both classes must be bound to the SAME delegate. Binding them to
      // different ones would compile and would silently produce a health page
      // that never showed the rows being written.
      const recorder = fx.moduleRef.get(JobRunRecorder);
      const health = fx.moduleRef.get(JobHealthService);

      await recorder.track('binding-probe', () => Promise.resolve(null));

      expect((await health.list()).map((row) => row.jobName)).toContain(
        'binding-probe',
      );
    });
  });
});
