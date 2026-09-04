import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  ANALYTICS_EXPORT_JOB_NAME,
  ANALYTICS_EXPORT_QUEUE,
  AnalyticsExportKind,
  formatErrorMsg,
  MAX_EXPORT_ROWS,
  safeTimezone,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { StorageReferenceService } from '../storage-client/storage-reference.service';
import {
  AnalyticsExportService,
  ExportJobData,
} from './analytics-export.service';

/**
 * The range holds more rows than one file may contain.
 *
 * A class rather than a message, because the CATCH needs to tell it apart: this
 * failure is deterministic, so the generic arm's rethrow would spend the
 * queue's one slot counting the same huge range three times to reach the same
 * answer. Same shape as `BudgetExhausted` in the ingestion processor, and the
 * same distinction `JobNoLongerRunnableError` draws.
 *
 * Carries the count, because "narrow it" is only actionable next to a number.
 */
export class ExportTooLarge extends Error {
  constructor(count: number, noun: string) {
    super(
      `This range has ${count.toLocaleString('en-US')} ${noun} rows, over the ${MAX_EXPORT_ROWS.toLocaleString('en-US')} limit. Narrow the range or the filters.`,
    );
    this.name = 'ExportTooLarge';
  }
}

/** The export row the renderer works from. */
type ExportRow = {
  id: string;
  organizationId: string;
  requestedById: string;
  kind: string;
  fromDay: Date;
  toDay: Date;
  departmentId: string | null;
  unrestricted: boolean;
  timezone: string | null;
  filters: Prisma.JsonValue;
};

/**
 * Produces the file.
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

      // **Recorded, not retried.** The count is the same on every attempt, so
      // the rethrow below would burn the queue's one slot — `concurrency: 1`,
      // three attempts, exponential backoff — running the same `count()` over
      // the same range to reach the answer the caller has already been given.
      // Storage and Prisma failures are the opposite kind and DO retry.
      if (error instanceof ExportTooLarge) {
        this.logger.warn(`Export ${exportId} refused: ${reason}`);

        return;
      }

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
  private async render(row: ExportRow): Promise<{
    csv: string;
    rowCount: number;
    rollupComputedAt: Date | null;
  }> {
    // A VarChar column, compared as a string — see the facade's note.
    const kind = row.kind;
    const { header, rows, rollupComputedAt } =
      kind === String(AnalyticsExportKind.AGENT_DAILY)
        ? await this.agentRows(row)
        : kind === String(AnalyticsExportKind.TICKET) // NOSONAR
          ? await this.ticketExportRows(row)
          : kind === String(AnalyticsExportKind.AUDIT_LOG) // NOSONAR
            ? await this.auditLogRows(row)
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

  /**
   * One row per TICKET, from the live table.
   *
   * **Pre-flight count, not a byte check afterwards.** `MAX_EXPORT_BYTES` would
   * refuse this too, but only after rendering — and with a message about a
   * limit the caller cannot act on. Counting first turns "your export failed"
   * into "this range has 140,000 tickets; narrow it".
   *
   * The count and the read share ONE `where`, so the number refused is the
   * number that would have been written.
   */
  private async ticketExportRows(row: ExportRow) {
    const where: Prisma.TicketWhereInput = {
      organizationId: row.organizationId,
      createdAt: {
        gte: zonedEdge(row.fromDay, zoneOf(row), 'start'),
        lte: zonedEdge(row.toDay, zoneOf(row), 'end'),
      },
      ...(row.departmentId ? { currentDepartmentId: row.departmentId } : {}),
      // **The same boundary the list applies**, resolved at request time. An
      // export is a read, and a read that ignores the boundary its list
      // respects is the widest possible leak of it.
      ...(row.unrestricted
        ? {}
        : {
            OR: [
              { authorId: row.requestedById },
              { currentAssigneeId: row.requestedById },
            ],
          }),
      ...ticketFilters(row.filters),
    };

    await this.assertWithinRowCap(
      this.prisma.ticket.count({ where }),
      'ticket',
    );

    const tickets = await this.prisma.ticket.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
    });

    return {
      header: [
        'ticket_id',
        'ticket_number',
        'title',
        'status',
        'priority',
        'department_id',
        'author_id',
        'assignee_id',
        'created_at',
        'resolved_at',
      ].join(','),
      rows: tickets.map((ticket) =>
        [
          ticket.id,
          ticket.ticketNumber,
          // Free text, unlike every rollup column — a subject with a comma or a
          // quote would otherwise shift every field after it.
          csvCell(ticket.title),
          ticket.status,
          ticket.priority,
          ticket.currentDepartmentId ?? '',
          ticket.authorId,
          ticket.currentAssigneeId ?? '',
          ticket.createdAt.toISOString(),
          ticket.resolvedAt?.toISOString() ?? '',
        ].join(','),
      ),
      // Live tables, so there is no recomputation to disclaim.
      rollupComputedAt: null,
    };
  }

  /** One row per audit entry. Same pre-flight discipline as the ticket export. */
  private async auditLogRows(row: ExportRow) {
    const where: Prisma.AuditLogWhereInput = {
      organizationId: row.organizationId,
      createdAt: {
        gte: zonedEdge(row.fromDay, zoneOf(row), 'start'),
        lte: zonedEdge(row.toDay, zoneOf(row), 'end'),
      },
      ...auditFilters(row.filters),
    };

    await this.assertWithinRowCap(
      this.prisma.auditLog.count({ where }),
      'audit log',
    );

    const entries = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
    });

    return {
      header: [
        'id',
        'action',
        'resource_type',
        'resource_id',
        'user_id',
        'ip_address',
        'user_agent',
        'created_at',
        'metadata',
      ].join(','),
      rows: entries.map((entry) =>
        [
          entry.id,
          entry.action,
          entry.resourceType,
          entry.resourceId ?? '',
          entry.userId ?? '',
          csvCell(entry.ipAddress ?? ''),
          csvCell(entry.userAgent ?? ''),
          entry.createdAt.toISOString(),
          // The nested column, flattened into one cell as JSON. This is the
          // argument for offering `application/json` on THIS export and not on
          // the ticket one.
          csvCell(
            entry.metadata === null ? '' : JSON.stringify(entry.metadata),
          ),
        ].join(','),
      ),
      rollupComputedAt: null,
    };
  }

  /**
   * @throws Error naming the count, which `fail()` writes to `error_log` and
   * the poll route hands back.
   */
  private async assertWithinRowCap(
    counting: Promise<number>,
    noun: string,
  ): Promise<void> {
    const count = await counting;
    if (count > MAX_EXPORT_ROWS) {
      throw new ExportTooLarge(count, noun);
    }
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
      // disagreement this exists to prevent, and shipping the inputs
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
      // Resolving hundreds of them per export to decorate a file
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

/**
 * One CSV cell, quoted when it has to be.
 *
 * The rollup exports never needed this — their columns are dates and integers.
 * A ticket subject and an audit `metadata` blob both routinely contain commas,
 * quotes and newlines, any of which shifts every field after it in a reader
 * that is not told otherwise. RFC 4180: wrap in quotes, double the quotes.
 */
function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;

  // `replaceAll`, not `replace(/"/g, …)`: the `/g` is the only thing making
  // the regex form correct, and an edit dropping it escapes the FIRST quote
  // only — a file that parses and is wrong, which is the worst failure an
  // export has. Rare too, since the guard above means this line only runs on a
  // value that already contains one.
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * The zone's offset from UTC at a given instant, in milliseconds.
 *
 * Via `Intl` rather than a table, because the offset is not a property of the
 * zone — it is a property of the zone AT A MOMENT, and a range that spans a DST
 * boundary has two.
 */
function offsetMs(instant: Date, timeZone: string): number {
  // `en-CA` for the ISO-ordered date, so the parts reassemble unambiguously.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const at = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  // The same wall-clock reading, interpreted as UTC. The difference from the
  // real instant IS the offset.
  const asUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour') % 24,
    at('minute'),
    at('second'),
  );

  return asUtc - instant.getTime();
}

/**
 * The instant a tenant-local day begins or ends.
 *
 * **`from_day`/`to_day` are the tenant's LOCAL dates** — the same domain the
 * rollups bucket by, per `TicketDailyStat.day`. `created_at` is a `timestamptz`.
 * Comparing one against UTC midnight exports a different range than the rollup
 * kinds do from the same request: at UTC+7, seven hours of the previous month
 * included and seven hours of the last day dropped.
 *
 * Two passes, because the offset is sampled at an instant: the first guess uses
 * the offset at UTC midnight, and if the corrected instant falls on the other
 * side of a DST transition its offset differs, so it is resolved again.
 */
function zonedEdge(day: Date, timeZone: string, edge: 'start' | 'end'): Date {
  const wall = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    ...(edge === 'start'
      ? ([0, 0, 0, 0] as const)
      : ([23, 59, 59, 999] as const)),
  );

  const first = wall - offsetMs(new Date(wall), timeZone);
  const second = wall - offsetMs(new Date(first), timeZone);

  return new Date(second);
}

/** The stored JSON, read back as the shape its kind allows and nothing wider. */
function readFilters(filters: Prisma.JsonValue): Record<string, string> {
  if (
    typeof filters !== 'object' ||
    filters === null ||
    Array.isArray(filters)
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(filters).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function ticketFilters(filters: Prisma.JsonValue): Prisma.TicketWhereInput {
  const { status, priority, assigneeId } = readFilters(filters);

  return {
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(assigneeId ? { currentAssigneeId: assigneeId } : {}),
  };
}

function auditFilters(filters: Prisma.JsonValue): Prisma.AuditLogWhereInput {
  const { action, resourceType, userId } = readFilters(filters);

  return {
    ...(action ? { action } : {}),
    ...(resourceType ? { resourceType } : {}),
    ...(userId ? { userId } : {}),
  };
}

/** NULL means UTC — the rule `safeTimezone` already encodes. */
function zoneOf(row: ExportRow): string {
  return safeTimezone(row.timezone);
}
