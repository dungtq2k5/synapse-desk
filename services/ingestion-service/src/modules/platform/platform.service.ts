import { Injectable } from '@nestjs/common';
import type {
  PlatformUsageRequest,
  PlatformUsageResponse,
} from '@synapsedesk/grpc-proto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cross-tenant usage reads.
 *
 * **Nothing here calls `tenantScope`, and that is the point and the risk** —
 * the same deliberate exposure `auth-service`'s `PlatformService` carries, which
 * is why it lives in its own module behind its own gRPC service rather than as
 * another method on `DocumentsService`.
 *
 * It answers what `GetStorageUsage` answers, for many tenants and without a
 * caller context. Widening that RPC instead would have put a cross-tenant read
 * beside tenant-scoped ones, where a missing filter reads exactly like the
 * surrounding code.
 */
@Injectable()
export class PlatformUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bytes and document count per organization, for every id ASKED ABOUT.
   *
   * **Zero-filled, and that is a contract rather than a convenience.** The
   * `groupBy` returns no row for a tenant with no documents, so a pass-through
   * would leave the caller to decide what a missing id means — and the two
   * available readings, "under the limit" and "not checked", are exactly the
   * pair an entitlement check must keep apart. Filling here makes the sparse
   * case unrepresentable rather than handled.
   *
   * One query for N tenants: the projection asks about every subscriber of a
   * plan at once, and a per-tenant loop is the shape this surface replaces.
   *
   * @param request the organization ids to report on; duplicates collapse.
   */
  async getPlatformUsage(
    request: PlatformUsageRequest,
  ): Promise<PlatformUsageResponse> {
    // Deduplicated because the response is keyed by id: a repeated id would
    // otherwise produce two rows saying the same thing, and a caller building a
    // Map would never notice.
    const ids = [...new Set(request.organizationIds)];

    if (ids.length === 0) return { usage: [] };

    const rows = await this.prisma.document.groupBy({
      by: ['organizationId'],
      where: { organizationId: { in: ids }, deletedAt: null },
      _sum: { fileSizeBytes: true },
      _count: true,
    });

    const byOrganization = new Map(
      rows.map((row) => [
        row.organizationId,
        {
          usedBytes: Number(row._sum.fileSizeBytes ?? 0n),
          documentCount: row._count,
        },
      ]),
    );

    return {
      usage: ids.map((organizationId) => ({
        organizationId,
        usedBytes: byOrganization.get(organizationId)?.usedBytes ?? 0,
        documentCount: byOrganization.get(organizationId)?.documentCount ?? 0,
      })),
    };
  }
}
