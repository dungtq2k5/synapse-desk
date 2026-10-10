import { faker } from '@faker-js/faker';
import {
  DocumentFlagSeverity,
  DocumentFlagType,
  DocumentStatus,
} from '@synapsedesk/common';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

/**
 * A tenant, in Domain C, is a set of uuids.
 *
 * There is no `organizations` table in this database to create a row in — the
 * tenant lives in postgres_auth and reaches this service only as an id in gRPC
 * metadata. A fixture that "created a tenant" here would be inventing a table
 * that must not exist.
 */
export type TenantFixture = {
  organizationId: string;
  userId: string;
  /** Two departments, because the interesting scoping cases need both. */
  departmentId: string;
  otherDepartmentId: string;
};

export function buildTenant(
  overrides: Partial<TenantFixture> = {},
): TenantFixture {
  return {
    organizationId: faker.string.uuid(),
    userId: faker.string.uuid(),
    departmentId: faker.string.uuid(),
    otherDepartmentId: faker.string.uuid(),
    ...overrides,
  };
}

let documentIdx = 0;

export function createDocument(
  prisma: PrismaService,
  tenant: TenantFixture,
  overrides: Partial<Prisma.DocumentUncheckedCreateInput> = {},
) {
  documentIdx++;

  return prisma.document.create({
    data: {
      organizationId: tenant.organizationId,
      createdById: tenant.userId,
      title: `Handbook ${documentIdx}`,
      fileUrl: `organizations/${tenant.organizationId}/documents/${faker.string.uuid()}/${faker.string.uuid()}.pdf`,
      fileType: 'pdf',
      fileSizeBytes: BigInt(1024),
      // Unique per row unless a test deliberately collides them — the dedup
      // tests are the only place a repeated hash is the point.
      fileHash: faker.string.hexadecimal({ length: 64, prefix: '' }),
      isOrganizationWide: true,
      status: DocumentStatus.PENDING,
      ...overrides,
    },
    include: { departmentLinks: true },
  });
}

/**
 * A document scoped to departments — org-wide OFF and links created together.
 *
 * Together on purpose: a row with `isOrganizationWide: true` AND department
 * links is a state the service refuses to create, so a fixture producing it
 * would make a visibility test pass against something the product cannot
 * actually produce.
 */
export async function createScopedDocument(
  prisma: PrismaService,
  tenant: TenantFixture,
  departmentIds: string[],
  overrides: Partial<Prisma.DocumentUncheckedCreateInput> = {},
) {
  const document = await createDocument(prisma, tenant, {
    isOrganizationWide: false,
    ...overrides,
  });

  await prisma.departmentDocument.createMany({
    data: departmentIds.map((departmentId) => ({
      documentId: document.id,
      departmentId,
    })),
  });

  return document;
}

/** Chunks carrying the four denormalized scope columns, as ingestion writes them. */
export async function createChunks(
  prisma: PrismaService,
  document: {
    id: string;
    organizationId: string;
    isOrganizationWide: boolean;
  },
  count: number,
  departmentIds: string[] = [],
) {
  for (let index = 0; index < count; index++) {
    await prisma.documentChunk.create({
      data: {
        documentId: document.id,
        chunkIndex: index,
        contentText: faker.lorem.paragraph(),
        pageNumber: index + 1,
        tokenCount: 128,
        organizationId: document.organizationId,
        isOrganizationWide: document.isOrganizationWide,
        departmentIds,
        isDeleted: false,
      },
    });
  }
}

/** A raised flag, unresolved unless the caller says otherwise. */
export function createFlag(
  prisma: PrismaService,
  document: { id: string; organizationId: string },
  overrides: Partial<Prisma.DocumentFlagUncheckedCreateInput> = {},
) {
  return prisma.documentFlag.create({
    data: {
      organizationId: document.organizationId,
      documentId: document.id,
      flagType: DocumentFlagType.UNRETRIEVED,
      severity: DocumentFlagSeverity.INFO,
      detail: 'Indexed and never retrieved.',
      ...overrides,
    },
  });
}
