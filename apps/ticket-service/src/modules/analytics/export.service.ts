import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Queue } from 'bullmq';
import {
  EXPORT_JOB_NAME,
  EXPORT_QUEUE,
  ExportKind,
  ExportStatus,
  AuditAction,
  AuditPublisher,
  AuditResourceType,
  CallerContext,
  formatErrorMsg,
  EXPORT_FILTER_KEYS,
  EXPORT_FILTER_VALUES,
  MAX_EXPORT_SPAN_DAYS,
  requireActor,
  requireTenant,
  safeTimezone,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';
import { Prisma } from '../../generated/prisma/client';

/** The BullMQ payload for one export job — what the worker needs to produce the file. */
export type ExportJobData = {
  exportId: string;
};

/**
 * `GET /analytics/export`.
 *
 * **Not a read.** It creates a job, produces a file and returns a download URL,
 * which is why it needs an owner at all: ticket-service owns most of the source
 * data.
 *
 * Two things that are easy to get wrong, both handled here:
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
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublisher,
    private readonly authReference: AuthReferenceService,
    @InjectQueue(EXPORT_QUEUE) private readonly queue: Queue,
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
      /** Raw JSON off the wire. Parsed and validated here, never trusted. */
      filters?: string;
    },
    context: CallerContext,
  ): Promise<{ exportId: string; status: string }> {
    const organizationId = requireTenant(context);
    const requestedById = requireActor(context);
    const kind = this.validateKind(input.kind);
    this.assertSpan(input.from, input.to);
    const filters = this.parseFilters(kind, input.filters);

    // Resolved BEFORE the dedupe, because it is part of what makes two requests
    // the same request — see the `where` below.
    const unrestricted =
      context.isSuperAdmin ||
      context.permissionCodes.includes('ticket.read.all');

    // Resolved HERE, not in the worker: `from_day`/`to_day` are the tenant's
    // local dates, and the row exports compare them against a `timestamptz`.
    // The rollup job makes the same call — one definition of "August" for both
    // paths, instead of two that differ by the tenant's offset.
    const timezone = safeTimezone(
      (
        await this.authReference.listOrganizationTimezones([organizationId])
      ).get(organizationId),
    );

    // **An identical request already in flight returns THAT one.**
    //
    // `enqueue`'s `jobId` already makes a duplicated ENQUEUE a no-op; this is
    // the same idea one layer up, where a duplicate costs a file rather than a
    // job. Without it a double-click writes two rows, two jobs and two objects
    // — and nothing sweeps exports, so the second is a full copy of tenant data
    // kept forever.
    //
    // Matched on the whole request, not just the kind: two different ranges are
    // two different exports. Only PENDING — a RUNNING one is already reading,
    // and a READY one is a file the caller can have again.
    const inFlight = await this.prisma.export.findFirst({
      where: {
        organizationId,
        // **The REQUESTER is part of the identity, not just the range.**
        // Without this a caller is handed an export somebody else's visibility
        // built: an Org Admin's `unrestricted` file, returned to an agent who
        // asked for the same range. `get()` is scoped too, and each is
        // insufficient alone — scoping the read without widening this hands the
        // second caller an id their own poll then refuses.
        requestedById,
        unrestricted,
        kind,
        fromDay: input.from,
        toDay: input.to,
        departmentId: input.departmentId ?? null,
        // `undefined` here would mean "do not constrain", so an unfiltered
        // request would match every filtered PENDING row — the exact case this
        // widening exists for. `DbNull` is the column being SQL NULL;
        // `JsonNull` would be the column holding the JSON value `null`, which
        // is not what an absent filter writes.
        filters:
          filters === undefined
            ? { equals: Prisma.DbNull }
            : { equals: filters },
        status: ExportStatus.PENDING,
      },
    });

    if (inFlight) {
      return { exportId: inFlight.id, status: inFlight.status };
    }

    const row = await this.prisma.export.create({
      data: {
        organizationId,
        requestedById,
        kind,
        fromDay: input.from,
        toDay: input.to,
        departmentId: input.departmentId,
        filters,
        // **Captured now, from the caller.** The renderer runs later with no
        // context, and re-deriving would widen the file after a grant or fail
        // it after a revoke — neither is what was asked for. The same predicate
        // `TicketAccessService.visibilityScope` applies to the list, resolved
        // to the one bit that determines it.
        unrestricted,
        timezone,
        status: ExportStatus.PENDING,
      },
    });

    try {
      await this.queue.add(
        EXPORT_JOB_NAME,
        { exportId: row.id } satisfies ExportJobData,
        {
          // The row id, so a duplicated enqueue is a no-op rather than two
          // files. No colons: BullMQ uses them as its own Redis key delimiter
          // and rejects a custom id containing one — the mistake found
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

    // **At request time, not on completion.** The act being recorded is that a
    // person asked for a copy of tenant data, which is true whether or not the
    // file ever renders — and for the audit-log kind it closes a circularity:
    // the one export whose purpose is compliance was the one act missing from
    // the log it exports.
    //
    // The RANGE and the kind, never the filters: a ticket filter carries a
    // search term, and an audit trail is not a second copy of tenant prose.
    this.audit.record(context, {
      action: AuditAction.DATA_EXPORT_REQUESTED,
      resourceType: AuditResourceType.EXPORT,
      resourceId: row.id,
      metadata: {
        kind,
        fromDay: input.from.toISOString(),
        toDay: input.to.toISOString(),
      },
    });

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

    // **An export belongs to the person who asked for it.**
    //
    // Not merely provenance: the file was rendered under THIS requester's
    // visibility (`unrestricted`), so handing it to a colleague hands them a
    // view they may not have. Tenant scoping alone is not enough — the boundary
    // that matters here is per-user, which is why the column exists.
    const row = await this.prisma.export.findFirst({
      where: {
        id: exportId,
        organizationId,
        requestedById: requireActor(context),
      },
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
    await this.prisma.export.update({
      where: { id: exportId },
      data: {
        status: ExportStatus.READY,
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
   * Called for a render or upload failure, and for a range over
   * `MAX_EXPORT_ROWS`. **Not for an empty result** — see
   * {@link ExportStatus.FAILED}: a quiet range is `READY` with a
   * header-only file, and the provenance header is what distinguishes it from
   * a job that never ran.
   */
  async fail(exportId: string, reason: string): Promise<void> {
    await this.prisma.export.update({
      where: { id: exportId },
      data: {
        status: ExportStatus.FAILED,
        // Truncated: a driver stack trace can be kilobytes and the first line
        // is what anybody reads. Same convention as `ingestion_jobs.error_log`.
        errorLog: reason.slice(0, 1_000),
        completedAt: new Date(),
      },
    });

    this.logger.error(`Export ${exportId} failed: ${reason}`);
  }

  /**
   * Refuses a range longer than {@link MAX_EXPORT_SPAN_DAYS}.
   *
   * The CHEAP guard, before any row is counted or read. It bounds days while
   * the byte bound counts rows, so it guarantees nothing on its own — the row
   * cap the renderer checks is what holds the line. This exists so the common
   * mistake ("export everything") is refused instantly and by a message that
   * names the limit.
   *
   * Enforced at the SERVICE, not only the gateway DTO: this is reachable over
   * gRPC, where no `ValidationPipe` ever ran.
   *
   * @throws RpcException INVALID_ARGUMENT for an inverted or over-long range.
   */
  private assertSpan(from: Date, to: Date): void {
    if (to < from) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'The export range ends before it begins',
      });
    }

    // Inclusive of both ends, matching how the range reads to a caller asking
    // for "1 March to 31 March".
    const days =
      Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;

    if (days > MAX_EXPORT_SPAN_DAYS) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `An export may cover at most ${MAX_EXPORT_SPAN_DAYS} days; this range is ${days}`,
      });
    }
  }

  /**
   * Parses the wire's `filters` JSON into the shape this kind allows.
   *
   * **The JSON column is storage, not a contract.** An unknown key is refused
   * rather than stored and ignored — a filter a caller believes applied and
   * that silently did not is the same failure `listDocumentFlags` refuses an
   * unknown flag type for.
   *
   * @throws RpcException INVALID_ARGUMENT for malformed JSON, a non-object, or
   * a key this kind does not define.
   */
  private parseFilters(
    kind: ExportKind,
    raw: string | undefined,
  ): Prisma.InputJsonValue | undefined {
    if (!raw?.trim()) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'The export filters are not valid JSON',
      });
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'The export filters must be a JSON object',
      });
    }

    const allowed = EXPORT_FILTER_KEYS[kind];
    const unknown = Object.keys(parsed).filter(
      (key) => !allowed.includes(key as never),
    );

    if (unknown.length > 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message:
          allowed.length === 0
            ? `The ${kind} export takes no filters; got: ${unknown.join(', ')}`
            : `Unknown filter(s) for ${kind}: ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}`,
      });
    }

    // **Values too, where the key names an enum.** An unknown VALUE reaches
    // Prisma, matches nothing and produces a READY zero-row export — the same
    // silently-dropped filter the key check above refuses, one level down.
    for (const [key, value] of Object.entries(parsed)) {
      const legal = EXPORT_FILTER_VALUES[key];
      if (!legal || (typeof value === 'string' && legal.includes(value))) {
        continue;
      }

      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `'${String(value)}' is not a valid ${key}. Allowed: ${legal.join(', ')}`,
      });
    }

    return parsed;
  }

  private validateKind(kind: string): ExportKind {
    const match = Object.values(ExportKind).find(
      (value) => String(value) === kind,
    );
    if (match) return match;

    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `Unknown export kind '${kind}'`,
    });
  }
}
