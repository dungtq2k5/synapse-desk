import { IngestionJobStatus } from '@synapsedesk/common';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { TenantFixture } from './document.factory';

/**
 * One ingestion attempt against an existing document.
 *
 * `organizationId` defaults from the tenant and is overridable, so a test can
 * make it disagree with the document's.
 */
export function createIngestionJob(
  prisma: PrismaService,
  tenant: TenantFixture,
  documentId: string,
  overrides: Partial<Prisma.IngestionJobUncheckedCreateInput> = {},
) {
  return prisma.ingestionJob.create({
    data: {
      organizationId: tenant.organizationId,
      documentId,
      // Empty is what a row created in the confirm transaction looks like.
      bullmqJobId: '',
      status: IngestionJobStatus.QUEUED,
      ...overrides,
    },
  });
}
