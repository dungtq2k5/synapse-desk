import { Injectable, Logger } from '@nestjs/common';
import { formatErrorMsg } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Records that a job ran — 20-doc §4.1.
 *
 * **The observability half of the fix, and the deeper one.** The jobs not
 * running was not the worst of it; the worst of it was that nothing anywhere
 * could tell you they were not running. A failed job logs. A job that never
 * runs logs nothing, and its output is zeros that every endpoint reports
 * correctly.
 *
 * One row per job name, upserted. `last_succeeded_at` is **preserved across a
 * failure** — see `fail()`.
 */
@Injectable()
export class JobRunRecorder {
  private readonly logger = new Logger(JobRunRecorder.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Wraps a run: records the start, then success or failure.
   *
   * **A bookkeeping failure never fails the job.** The run already happened and
   * already did its work; throwing here would turn a heartbeat outage into a
   * lost night's rollup, which inverts the entire point of the table.
   */
  async track<T>(jobName: string, run: () => Promise<T>): Promise<T> {
    const startedAt = new Date();

    await this.swallow(() => this.start(jobName, startedAt));

    try {
      const result = await run();

      await this.swallow(() =>
        this.succeed(jobName, Date.now() - startedAt.getTime()),
      );

      return result;
    } catch (error) {
      await this.swallow(() =>
        this.fail(
          jobName,
          Date.now() - startedAt.getTime(),
          formatErrorMsg(error),
        ),
      );

      throw error;
    }
  }

  private start(jobName: string, startedAt: Date): Promise<unknown> {
    return this.prisma.jobRun.upsert({
      where: { jobName },
      create: { jobName, lastStartedAt: startedAt },
      update: { lastStartedAt: startedAt },
    });
  }

  private succeed(jobName: string, durationMs: number): Promise<unknown> {
    return this.prisma.jobRun.update({
      where: { jobName },
      data: {
        lastSucceededAt: new Date(),
        lastDurationMs: durationMs,
        // Cleared, so a run that recovers stops reporting the old reason —
        // the same rule `analytics_exports.error_log` follows.
        lastError: null,
        consecutiveFailures: 0,
      },
    });
  }

  /**
   * Records a failure **without touching `last_succeeded_at`**.
   *
   * That field is what the staleness alert reads. Clearing it here would turn
   * "broken since Tuesday" into "never ran" and lose the only piece of
   * information worth having — 20-doc §4 test 2.
   */
  private fail(
    jobName: string,
    durationMs: number,
    reason: string,
  ): Promise<unknown> {
    return this.prisma.jobRun.update({
      where: { jobName },
      data: {
        lastDurationMs: durationMs,
        // Truncated: a driver stack trace is kilobytes and the first line is
        // what anybody reads.
        lastError: reason.slice(0, 1_000),
        consecutiveFailures: { increment: 1 },
      },
    });
  }

  private async swallow(write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.logger.error(`Could not record a job run: ${formatErrorMsg(error)}`);
    }
  }
}
