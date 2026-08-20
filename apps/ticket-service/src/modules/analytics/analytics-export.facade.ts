import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { CallerContext, requireTenant } from '@synapsedesk/common';
import {
  CreateExportRequest,
  ExportResponse,
  toProtoTimestamp,
  fromProtoAnalyticsExportKind,
  toProtoAnalyticsExportKind,
  toProtoAnalyticsExportStatus,
  AnalyticsExportStatus as ProtoAnalyticsExportStatus,
} from '@synapsedesk/grpc-proto';
import { AnalyticsExportService } from './analytics-export.service';
import { StorageReferenceService } from '../storage-client/storage-reference.service';

/**
 * Wire ↔ domain for the export.
 *
 * Separate from `AnalyticsExportService` because that one is also the WORKER's
 * collaborator, and the worker has no wire types and no caller. Keeping the
 * mapping out of it is what stops a proto message reaching a background job.
 */
@Injectable()
export class AnalyticsExportFacade {
  constructor(
    private readonly exports: AnalyticsExportService,
    private readonly storage: StorageReferenceService,
  ) {}

  async create(
    request: CreateExportRequest,
    context: CallerContext,
  ): Promise<ExportResponse> {
    // **Rejected rather than defaulted**, and as INVALID_ARGUMENT rather than as
    // a bare throw: guessing TICKET_DAILY would hand somebody a file of the
    // wrong shape under a name they chose.
    //
    // Null covers both remaining cases now that the field is an enum —
    // UNSPECIFIED, meaning the caller named no kind, and UNRECOGNIZED, meaning
    // a kind some newer build knows and this one cannot produce. Neither is
    // something to answer with a file.
    const kind = fromProtoAnalyticsExportKind(request.kind);
    if (!kind) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Unknown export kind',
      });
    }

    const { exportId } = await this.exports.request(
      {
        kind,
        from: parseDay(request.from),
        to: parseDay(request.to),
        departmentId: request.departmentId,
        filters: request.filters,
      },
      context,
    );

    return this.get(exportId, context);
  }

  async get(exportId: string, context: CallerContext): Promise<ExportResponse> {
    const organizationId = requireTenant(context);
    const row = await this.exports.get(exportId, context);

    // The URL is minted PER REQUEST rather than stored: a signed link to a
    // tenant's full ticket history is a credential, and putting one in a
    // database turns a read into a durable secret.
    // Narrowed ONCE, and reused for both the link decision and the response —
    // `row.status` is a VarChar, so comparing it directly against the enum is
    // asserting the very thing being checked.
    const status = toProtoAnalyticsExportStatus(row.status);

    const downloadUrl =
      status === ProtoAnalyticsExportStatus.ANALYTICS_EXPORT_STATUS_READY &&
      row.objectPath
        ? await this.storage.resolveExportUrl(row.objectPath, organizationId)
        : null;

    return {
      id: row.id,
      status,
      kind: toProtoAnalyticsExportKind(row.kind),
      rowCount: row.rowCount ?? undefined,
      rollupComputedAt: row.rollupComputedAt
        ? toProtoTimestamp(row.rollupComputedAt)
        : undefined,
      downloadUrl: downloadUrl ?? undefined,
      error: row.errorLog ?? undefined,
      createdAt: toProtoTimestamp(row.createdAt),
      completedAt: row.completedAt
        ? toProtoTimestamp(row.completedAt)
        : undefined,
    };
  }
}

/** `YYYY-MM-DD` at UTC midnight — the `date` column's domain. */
function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
