import { faker } from '@faker-js/faker';
import { AuditAction, AuditResourceType } from '@synapsedesk/common';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

/**
 * A row as the NATS consumer would have written it.
 *
 * `organizationId` is nullable and that nullability is load-bearing: a platform
 * act belongs to the platform, not to the customer it touched, so a fixture
 * must be able to produce a row with no tenant. Tests that assert the
 * consumer's scoping depend on being able to build both shapes.
 */
export function createAuditLog(
  prisma: PrismaService,
  overrides: Partial<Prisma.AuditLogUncheckedCreateInput> = {},
) {
  return prisma.auditLog.create({
    data: {
      organizationId: faker.string.uuid(),
      userId: faker.string.uuid(),
      action: AuditAction.USER_CREATED,
      resourceType: AuditResourceType.USER,
      resourceId: faker.string.uuid(),
      ipAddress: faker.internet.ipv4(),
      userAgent: faker.internet.userAgent(),
      metadata: {},
      ...overrides,
    },
  });
}
