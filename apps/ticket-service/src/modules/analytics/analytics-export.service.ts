import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Queue } from 'bullmq';
import {
  ANALYTICS_EXPORT_JOB_NAME,
  ANALYTICS_EXPORT_QUEUE,
  AnalyticsExportKind,
  AnalyticsExportStatus,
  CallerContext,
  formatErrorMsg,
  requireActor,
  requireTenant,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';

/** What the worker needs to produce the file. */
export type ExportJobData = {
  exportId: string;
};

/**
 * `GET /analytics/export` — 19-doc §5.
 *
 * **Not a read.** It creates a job, produces a file and returns a download URL,
 * which is why it needs an owner at all: ticket-service owns most of the source
 * data.
 *
 * Two things §5 calls out as easy to get wrong, both handled here:
 *
 *   - **An export is a SNAPSHOT with a timestamp in it.** Two people exporting
 *     "last quarter" a week apart get different numbers if a backfill ran
 *     between, so the row and the file both record when it was generated and
 *     the newest rollup run behind it. Without that it becomes a disputed
 *     number in a meeting with nothing to settle it.
 *   - **Exports EXPIRE.** A signed URL to a file containing a tenant's full
 *     ticket history is a credential, so the URL is short-lived and the object
 *     carries a retention policy.
 */
@Injectable()
export class AnalyticsExportService {
  private readonly logger = new Logger(AnalyticsExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(ANALYTICS_EXPORT_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Creates the row, queues the work and returns IMMEDIATELY.
   *
   * The row is written BEFORE the job is enqueued, so a caller always has
   * something to poll: a job id that names nothing is worse than a slow export,
   * because the client cannot tell "still working" from "never started".
   */
  async request(
    input: {
      kind: string;
      from: Date;
      to: Date;
      departmentId?: string;
    },
    context: CallerContext,
  ): Promise<{ exportId: string; status: string }> {
    const organizationId = requireTenant(context);
    const requestedById = requireActor(context);
    const kind = this.validateKind(input.kind);

    const row = await this.prisma.analyticsExport.create({
      data: {
        organizationId,
        requestedById,
        kind,
        fromDay: input.from,
        toDay: input.to,
        departmentId: input.departmentId,
        status: AnalyticsExportStatus.PENDING,
      },
    });

    try {
      await this.queue.add(
        ANALYTICS_EXPORT_JOB_NAME,
        { exportId: row.id } satisfies ExportJobData,
        {
          // The row id, so a duplicated enqueue is a no-op rather than two
          // files. No colons: BullMQ uses them as its own Redis key delimiter
          // and rejects a custom id containing one — the mistake 12-doc found
          // the hard way, where every enqueue failed into a deliberate swallow.
          jobId: `export-${row.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2_000 },
        },
      );
    } catch (error) {
      // The row exists and says PENDING, which would be a lie forever. Marked
      // FAILED here so the caller learns now rather than by polling something
      // that will never move.
      await this.fail(row.id, formatErrorMsg(error));

      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'Could not queue the export; please try again',
      });
    }

    return { exportId: row.id, status: row.status };
  }

  /**
   * One export's state.
   *
   * **404, not 403, for another tenant's id.** A 403 confirms the job exists,
   * which turns this into an oracle for how much a competitor exports. Same
   * rule as everywhere else in the system.
   */
  async get(exportId: string, context: CallerContext) {
    const organizationId = requireTenant(context);

    const row = await this.prisma.analyticsExport.findFirst({
      where: { id: exportId, organizationId },
    });

    if (!row) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No export with that id',
      });
    }

    return row;
  }

  /** Marks an export ready, with everything a reader needs to trust the file. */
  async complete(
    exportId: string,
    details: {
      objectPath: string;
      rowCount: number;
      rollupComputedAt: Date | null;
    },
  ): Promise<void> {
    await this.prisma.analyticsExport.update({
      where: { id: exportId },
      data: {
        status: AnalyticsExportStatus.READY,
        objectPath: details.objectPath,
        rowCount: details.rowCount,
        rollupComputedAt: details.rollupComputedAt,
        // CLEARED, and this is not tidiness. A retry that succeeds after a
        // transient failure would otherwise be READY with an error message
        // still attached — and a caller reading both has no way to tell whether
        // the file it just downloaded is trustworthy.
        errorLog: null,
        completedAt: new Date(),
      },
    });
  }

  /**
   * Marks an export FAILED.
   *
   * **A failed export reports failure rather than producing an empty file.** An
   * empty CSV reads as "no data", which is a wrong answer rather than an error
   * — and the reader has no way to tell the difference.
   */
  async fail(exportId: string, reason: string): Promise<void> {
    await this.prisma.analyticsExport.update({
      where: { id: exportId },
      data: {
        status: AnalyticsExportStatus.FAILED,
        // Truncated: a driver stack trace can be kilobytes and the first line
        // is what anybody reads. Same convention as `ingestion_jobs.error_log`.
        errorLog: reason.slice(0, 1_000),
        completedAt: new Date(),
      },
    });

    this.logger.error(`Export ${exportId} failed: ${reason}`);
  }

  private validateKind(kind: string): AnalyticsExportKind {
    const match = Object.values(AnalyticsExportKind).find(
      (value) => String(value) === kind,
    );
    if (match) return match;

    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `Unknown export kind '${kind}'`,
    });
  }
}
