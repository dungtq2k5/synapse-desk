import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  ANALYTICS_EXPORT_JOB_NAME,
  ANALYTICS_EXPORT_QUEUE,
  AnalyticsExportKind,
  formatErrorMsg,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageReferenceService } from '../storage-client/storage-reference.service';
import {
  AnalyticsExportService,
  ExportJobData,
} from './analytics-export.service';

/**
 * Produces the file — 19-doc §5.
 *
 * A BullMQ worker rather than a detached promise, and the difference is one
 * property: an export in flight when a replica restarts is RETRIED rather than
 * lost. A row stuck at `PENDING` forever, with a client polling it, is the
 * failure mode that makes people stop trusting the button.
 *
 * ticket-service had no queue before this — the first one here — which is why
 * `BullModule.forRootAsync` is registered in `AnalyticsModule` rather than in
 * `AppModule`: registering globally would put a Redis connection in every
 * process that imports the app, including the test bootstraps that never
 * export anything.
 */
@Processor(ANALYTICS_EXPORT_QUEUE, {
  // One at a time. An export is a bulk read over a range, and the whole design
  // exists so analytics does not compete with the hot path — running four at
  // once would put that competition back by a different route.
  concurrency: 1,
})
export class AnalyticsExportProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyticsExportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exports: AnalyticsExportService,
    private readonly storage: StorageReferenceService,
  ) {
    super();
  }

  async process(job: Job<ExportJobData>): Promise<void> {
    if (job.name !== ANALYTICS_EXPORT_JOB_NAME) {
      this.logger.warn(`Ignoring unknown job '${job.name}' on this queue`);
      return;
    }

    const { exportId } = job.data;

    const row = await this.prisma.analyticsExport.findUnique({
      where: { id: exportId },
    });
    if (!row) {
      // The row was deleted between enqueue and pickup — a tenant offboarding,
      // most likely. Nothing to fail and nothing to produce.
      this.logger.warn(`Export ${exportId} no longer exists; skipping`);
      return;
    }

    try {
      const { csv, rowCount, rollupComputedAt } = await this.render(row);
      const objectPath = await this.upload(row, csv);

      await this.exports.complete(exportId, {
        objectPath,
        rowCount,
        rollupComputedAt,
      });

      this.logger.log(`Export ${exportId} ready: ${rowCount} row(s)`);
    } catch (error) {
      const reason = formatErrorMsg(error);
      await this.exports.fail(exportId, reason);

      // Rethrown so BullMQ retries. `fail()` has already recorded the reason,
      // so a caller polling mid-retry sees FAILED with an explanation rather
      // than PENDING with none — and a later attempt that succeeds overwrites
      // it with READY.
      throw error;
    }
  }

  /**
   * The rows, as CSV, with a PROVENANCE HEADER.
   *
   * **The disputed-number guard.** Two people exporting "last quarter" a week
   * apart get different numbers if a backfill ran between, and without this the
   * only thing they can do is argue. The header says when the file was made and
   * the newest rollup run behind it, so the difference is explainable in ten
   * seconds.
   *
   * A comment-prefixed header rather than extra columns: every row carrying the
   * same two values is noise in a spreadsheet, and `#` is what every CSV reader
   * in common use skips.
   */
  private async render(row: {
    id: string;
    organizationId: string;
    kind: string;
    fromDay: Date;
    toDay: Date;
    departmentId: string | null;
  }): Promise<{
    csv: string;
    rowCount: number;
    rollupComputedAt: Date | null;
  }> {
    const { header, rows, rollupComputedAt } =
      // A VarChar column, compared as a string — see the facade's note.
      row.kind === String(AnalyticsExportKind.AGENT_DAILY)
        ? await this.agentRows(row)
        : await this.ticketRows(row);

    const provenance = [
      `# synapsedesk analytics export`,
      `# export_id=${row.id}`,
      `# generated_at=${new Date().toISOString()}`,
      // Absent when the range has no rollup rows at all — which is itself worth
      // saying, because it distinguishes "quiet tenant" from "job never ran".
      `# rollup_computed_at=${rollupComputedAt?.toISOString() ?? 'none'}`,
      `# range=${iso(row.fromDay)}..${iso(row.toDay)}`,
    ].join('\n');

    const csv = [provenance, header, ...rows].join('\n');

    return { csv, rowCount: rows.length, rollupComputedAt };
  }

  private async ticketRows(row: {
    organizationId: string;
    fromDay: Date;
    toDay: Date;
    departmentId: string | null;
  }) {
    const stats = await this.prisma.ticketDailyStat.findMany({
      where: {
        organizationId: row.organizationId,
        day: { gte: row.fromDay, lte: row.toDay },
        ...(row.departmentId ? { departmentId: row.departmentId } : {}),
      },
      orderBy: [{ day: 'asc' }],
    });

    return {
      // **Sums and counts, exactly as stored.** No rate is exported: a
      // spreadsheet that recomputed one differently from the dashboard is the
      // disagreement 19-doc §3.1 exists to prevent, and shipping the inputs
      // lets a reader derive whichever they want from the same numbers.
      header: [
        'day',
        'department_id',
        'tickets_created',
        'tickets_resolved',
        'tickets_escalated',
        'chat_conversations',
        'chat_resolved_without_escalation',
        'first_response_seconds_sum',
        'first_response_count',
        'ai_first_response_seconds_sum',
        'ai_first_response_count',
        'resolution_seconds_sum',
        'resolution_count',
        'feedback_positive',
        'feedback_negative',
        'citation_accurate_count',
        'citation_rated_count',
      ].join(','),
      rows: stats.map((stat) =>
        [
          iso(stat.day),
          stat.departmentId ?? '',
          stat.ticketsCreated,
          stat.ticketsResolved,
          stat.ticketsEscalated,
          stat.chatConversations,
          stat.chatResolvedWithoutEscalation,
          stat.firstResponseSecondsSum,
          stat.firstResponseCount,
          stat.aiFirstResponseSecondsSum,
          stat.aiFirstResponseCount,
          stat.resolutionSecondsSum,
          stat.resolutionCount,
          stat.feedbackPositive,
          stat.feedbackNegative,
          stat.citationAccurateCount,
          stat.citationRatedCount,
        ].join(','),
      ),
      rollupComputedAt: newest(stats.map((stat) => stat.computedAt)),
    };
  }

  private async agentRows(row: {
    organizationId: string;
    fromDay: Date;
    toDay: Date;
  }) {
    const stats = await this.prisma.agentDailyStat.findMany({
      where: {
        organizationId: row.organizationId,
        day: { gte: row.fromDay, lte: row.toDay },
      },
      orderBy: [{ day: 'asc' }, { agentId: 'asc' }],
    });

    return {
      // Agent IDs, not names. This service has never known a display name (RDM
      // §1.13), and resolving hundreds of them per export to decorate a file
      // would put a cross-service read inside a background job for a column
      // nobody joins on.
      header: [
        'day',
        'agent_id',
        'assigned',
        'resolved',
        'messages_sent',
        'resolution_seconds_sum',
        'resolution_count',
      ].join(','),
      rows: stats.map((stat) =>
        [
          iso(stat.day),
          stat.agentId,
          stat.assigned,
          stat.resolved,
          stat.messagesSent,
          stat.resolutionSecondsSum,
          stat.resolutionCount,
        ].join(','),
      ),
      rollupComputedAt: newest(stats.map((stat) => stat.computedAt)),
    };
  }

  /**
   * Presign, PUT, confirm — the same three steps every other upload takes.
   *
   * **Reusing `storage-service` with a new `purpose: EXPORT`** rather than
   * inventing a second file path: the signed-URL discipline, the tenant path
   * prefix and the deletion story all already exist there, and a parallel
   * mechanism for one feature is how a bucket ends up with two sets of rules.
   */
  private async upload(
    row: { id: string; organizationId: string },
    csv: string,
  ): Promise<string> {
    const body = Buffer.from(csv, 'utf8');

    const presigned = await this.storage.presignExport(
      row.id,
      body.byteLength,
      row.organizationId,
    );

    const response = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/csv' },
      body: new Uint8Array(body),
    });

    if (!response.ok) {
      throw new Error(
        `Storage rejected the export upload: ${response.status} ${response.statusText}`,
      );
    }

    await this.storage.confirmExportUpload(
      presigned.objectPath,
      row.organizationId,
    );

    return presigned.objectPath;
  }
}

/** A `date` column as `YYYY-MM-DD` — never a locale-formatted string. */
function iso(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function newest(dates: Date[]): Date | null {
  if (dates.length === 0) return null;

  return dates.reduce(
    (latest, date) => (date > latest ? date : latest),
    dates[0],
  );
}
