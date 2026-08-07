import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** One heartbeat row, as the platform surface reports it. */
export type JobRunStatusRow = {
  jobName: string;
  lastStartedAt: Date | null;
  lastSucceededAt: Date | null;
  lastDurationMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
};

/**
 * Reads the heartbeat — 20-doc §4.4.
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
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<JobRunStatusRow[]> {
    const rows = await this.prisma.jobRun.findMany({
      orderBy: { jobName: 'asc' },
    });

    return rows.map((row) => ({
      jobName: row.jobName,
      lastStartedAt: row.lastStartedAt,
      lastSucceededAt: row.lastSucceededAt,
      lastDurationMs: row.lastDurationMs,
      lastError: row.lastError,
      consecutiveFailures: row.consecutiveFailures,
    }));
  }
}
