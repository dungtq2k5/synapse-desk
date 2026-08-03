import { faker } from '@faker-js/faker';
import { PermissionCode, SystemRoleName } from '@synapsedesk/common';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

let roleIdx = 0;

export function buildRole(
  createdById: string,
  overrides: Partial<Prisma.RoleUncheckedCreateInput> = {},
): Prisma.RoleUncheckedCreateInput {
  roleIdx++;
  return {
    name: `${faker.person.jobTitle()} ${roleIdx}`,
    description: faker.lorem.sentence(),
    isSystemRole: false,
    createdById,
    ...overrides,
  };
}

/**
 * A tenant role holding exactly `permissionCodes`.
 *
 * Connects to permission ROWS rather than creating them: the catalogue is
 * seeded from `PERMISSION_CODES` and is the single source of truth. A factory
 * that created its own permission rows could mint a code no `@RequirePermission`
 * can ever reference — a green test proving nothing.
 */
export async function createRole(
  prisma: PrismaService,
  opts: {
    organizationId: string | null;
    createdById: string;
    permissionCodes?: readonly PermissionCode[];
    overrides?: Partial<Prisma.RoleUncheckedCreateInput>;
  },
) {
  const {
    organizationId,
    createdById,
    permissionCodes = [],
    overrides = {},
  } = opts;

  return prisma.role.create({
    data: {
      ...buildRole(createdById, { organizationId, ...overrides }),
      permissions: { connect: permissionCodes.map((code) => ({ code })) },
    },
    include: { permissions: true },
  });
}

/** Looks up a seeded global system role by name. */
export function findSystemRole(prisma: PrismaService, name: SystemRoleName) {
  return prisma.role.findFirstOrThrow({
    where: { name, organizationId: null, isSystemRole: true },
  });
}
