import { Injectable } from '@nestjs/common';
import type { GenerationStore, LimitAlertDimension } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The durable half of the alarm state, in this service's own database.
 *
 * Each service owns the generation for the dimensions it PRODUCES — the same
 * split as the counts themselves — so nothing here reaches across a service
 * boundary for a number it already has.
 */
@Injectable()
export class IngestionGenerationStore implements GenerationStore {
  constructor(private readonly prisma: PrismaService) {}

  /** Zero for a tenant that has never recovered, which is most of them. */
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
   * Increments and returns the new value, atomically.
   *
   * An `upsert` rather than a read-then-write: two concurrent recoveries would
   * otherwise both read `n` and both write `n + 1`, leaving two crossings
   * sharing an event id — which is exactly the collision the generation exists
   * to prevent.
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
}
