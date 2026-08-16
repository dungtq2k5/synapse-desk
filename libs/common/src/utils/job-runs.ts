import { Injectable, Logger } from '@nestjs/common';
import { formatErrorMsg } from './utils';
import type { JobHeartbeat } from './job-staleness';

/** A heartbeat row, as it is written and read. */
export type JobRunRow = {
  jobName: string;
  lastStartedAt: Date;
  lastSucceededAt?: Date | null;
  lastDurationMs?: number | null;
  lastError?: string | null;
  consecutiveFailures?: number;
};

/**
 * A partial update.
 *
 * `consecutiveFailures` is a UNION rather than an intersection: success sets it
 * to `0` and failure increments it, and Prisma accepts either form. Written as
 * `Partial<JobRunRow> & { consecutiveFailures?: { increment } }` it would
 * resolve to `number & { increment: number }` — a type nothing can satisfy,
 * which is a compile error rather than the two-shapes-one-field it means.
 */
export type JobRunUpdate = Omit<Partial<JobRunRow>, 'consecutiveFailures'> & {
  consecutiveFailures?: number | { increment: number };
};

/** One heartbeat row as the platform surface reports it. */
export type JobRunStatusRow = {
  jobName: string;
  lastStartedAt: Date | null;
  lastSucceededAt: Date | null;
  lastDurationMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
};

/**
 * **The two operations a heartbeat needs, and no more**
 *
 * Declared by hand rather than by importing Prisma's generated `JobRunDelegate`:
 * the generated types differ per service by client path, so depending on one
 * would drag a service's generated code into a shared library and make this
 * file un-importable from the other two.
 *
 * Each service passes its own `prisma.jobRun`, which satisfies this
 * structurally. `Promise<unknown>` on the write because nothing here reads the
 * returned row, and narrowing it would be a second reason for the three
 * delegates to have to agree.
 */
export interface JobRunStore {
  upsert(args: {
    where: { jobName: string };
    create: JobRunRow;
    update: Partial<JobRunRow>;
  }): Promise<unknown>;

  update(args: {
    where: { jobName: string };
    data: JobRunUpdate;
  }): Promise<unknown>;

  findMany(args?: {
    orderBy?: { jobName: 'asc' | 'desc' };
  }): Promise<JobRunStatusRow[]>;
}

/**
 * The injection token each service binds to its own `prisma.jobRun`.
 *
 * A token rather than a class, because the thing being injected is a Prisma
 * delegate — an object, not something Nest can construct.
 */
export const JOB_RUN_STORE = Symbol('JOB_RUN_STORE');

/**
 * Records that a job ran, hoisted here by §4.5.
 *
 * **The observability half of the fix, and the deeper one.** The jobs not
 * running was not the worst of it; the worst of it was that nothing anywhere
 * could tell you they were not running. A failed job logs. A job that never
 * runs logs nothing, and its output is zeros that every endpoint reports
 * correctly.
 *
 * **One copy, three tables.** The table stays declared in each service's
 * schema, because "did ingestion-service's rollup run?" is a question about
 * ingestion-service's database — a heartbeat written anywhere else can succeed
 * while that database is unreachable, which reports healthy for a job writing
 * nothing. That is the original bug with extra infrastructure. What was
 * genuinely duplicated was the CODE: 306 byte-identical lines across three
 * services, which is what this file replaces.
 */
@Injectable()
export class JobRunRecorder {
  private readonly logger = new Logger(JobRunRecorder.name);

  constructor(private readonly store: JobRunStore) {}

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
    return this.store.upsert({
      where: { jobName },
      create: { jobName, lastStartedAt: startedAt },
      update: { lastStartedAt: startedAt },
    });
  }

  private succeed(jobName: string, durationMs: number): Promise<unknown> {
    return this.store.update({
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
   * Records a failure **without touching `lastSucceededAt`**.
   *
   * That field is what the staleness alert reads. Clearing it here would turn
   * "broken since Tuesday" into "never ran" and lose the only piece of
   * information worth having test 2.
   */
  private fail(
    jobName: string,
    durationMs: number,
    reason: string,
  ): Promise<unknown> {
    return this.store.update({
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

/**
 * Reads the heartbeat, hoisted here by §4.5.
 *
 * **Every row, unfiltered.** The caller decides what is stale, because the
 * check has to be told which jobs it EXPECTS: a job that has never run has no
 * row at all, and a reader that only looks at what it finds reports nothing
 * wrong. That is the exact failure this table exists to catch, so the judgement
 * lives in `checkStaleness` where the expected list is passed in explicitly.
 *
 * No tenant scoping: these jobs sweep across every tenant, so "did the rollup
 * run" is one question with one answer per service.
 */
@Injectable()
export class JobHealthService {
  constructor(private readonly store: JobRunStore) {}

  async list(): Promise<JobRunStatusRow[]> {
    const rows = await this.store.findMany({ orderBy: { jobName: 'asc' } });

    return rows.map((row) => ({
      jobName: row.jobName,
      lastStartedAt: row.lastStartedAt,
      lastSucceededAt: row.lastSucceededAt,
      lastDurationMs: row.lastDurationMs,
      lastError: row.lastError,
      consecutiveFailures: row.consecutiveFailures,
    }));
  }

  /** The subset `checkStaleness` needs, so a caller need not reshape it. */
  async heartbeats(): Promise<JobHeartbeat[]> {
    const rows = await this.list();

    return rows.map((row) => ({
      jobName: row.jobName,
      lastSucceededAt: row.lastSucceededAt,
      consecutiveFailures: row.consecutiveFailures,
    }));
  }
}
