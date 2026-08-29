import { Injectable } from '@nestjs/common';
import type { GenerationStore, LimitAlertDimension } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The durable half of the alarm state for the dimension auth owns.
 *
 * Same shape as `ingestion-service`'s, in this service's own database: each
 * service owns the generation for the dimensions it produces, so the counter
 * never crosses a boundary the count does not.
 */
@Injectable()
export class AuthGenerationStore implements GenerationStore {
  constructor(private readonly prisma: PrismaService) {}

  async read(
    organizationId: string,
    dimension: LimitAlertDimension,
  ): Promise<number> {
    const row = await this.prisma.limitAlertGeneration.findUnique({
      where: { organizationId_dimension: { organizationId, dimension } },
      select: { generation: true },
    });

    return row?.generation ?? 0;
  }

  /**
   * Increments and returns the new value, atomically — an `upsert` rather than
   * a read-then-write, so two concurrent recoveries cannot both read `n` and
   * leave two crossings sharing an event id.
   */
  async bump(
    organizationId: string,
    dimension: LimitAlertDimension,
  ): Promise<number> {
    const row = await this.prisma.limitAlertGeneration.upsert({
      where: { organizationId_dimension: { organizationId, dimension } },
      create: { organizationId, dimension, generation: 1 },
      update: { generation: { increment: 1 } },
      select: { generation: true },
    });

    return row.generation;
  }

  /**
   * Everything this tenant has — for a HARD delete, never for offboarding.
   *
   * **Deleting these on a soft delete performs the failure they prevent.**
   * `restoreOrganization` un-deletes a tenant in place while Domain E's
   * `notifications` rows survive in another database, so a reset counter
   * republishes an event id the permanent index already holds and that
   * dimension goes quiet for that tenant forever.
   *
   * Call it where the notifications go too. Until hard deletion exists, the
   * bounded cost is three rows per departed tenant, which is the cheaper side
   * of the trade by a wide margin: the leak is bounded and the guard is not.
   */
  async clear(organizationId: string): Promise<void> {
    await this.prisma.limitAlertGeneration.deleteMany({
      where: { organizationId },
    });
  }
}
