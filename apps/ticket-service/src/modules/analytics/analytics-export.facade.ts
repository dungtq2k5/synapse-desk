import { Injectable } from '@nestjs/common';
import {
  AnalyticsExportStatus,
  CallerContext,
  requireTenant,
} from '@synapsedesk/common';
import {
  CreateExportRequest,
  ExportResponse,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { AnalyticsExportService } from './analytics-export.service';
import { StorageReferenceService } from '../storage-client/storage-reference.service';

/**
 * Wire ↔ domain for the export — 19-doc §5.
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
    const { exportId } = await this.exports.request(
      {
        kind: request.kind,
        from: parseDay(request.from),
        to: parseDay(request.to),
        departmentId: request.departmentId,
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
    const downloadUrl =
      // Compared as a STRING: `status` is a VarChar off the wire, and a direct
      // enum comparison would assert the very thing being checked.
      row.status === String(AnalyticsExportStatus.READY) && row.objectPath
        ? await this.storage.resolveExportUrl(row.objectPath, organizationId)
        : null;

    return {
      id: row.id,
      status: row.status,
      kind: row.kind,
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
