import { PermissionCode, SystemRoleName } from '@synapsedesk/common';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { createOrganization } from './organization.factory';
import { createDepartment, createUserDepartment } from './department.factory';
import { createRole, findSystemRole } from './role.factory';
import { createUserWithPassword, TEST_PASSWORD } from './user.factory';

export type SeededTenant = Awaited<ReturnType<typeof seedTenantWithUser>>;

/**
 * A ready-to-query tenant: organization + one department + one role holding
 * exactly `permissionCodes` + one user who holds that role and belongs to that
 * department as their primary.
 *
 * Nearly every module test needs this exact shape, and assembling it inline is
 * a dozen lines that obscure the two the test is actually about. `user_assigned`
 * is set to 1 here rather than left at 0 because the production write path
 * increments it — a fixture that skips it makes every counter assertion start
 * from a state the application would never produce.
 */
export async function seedTenantWithUser(
  prisma: PrismaService,
  opts: {
    permissionCodes?: readonly PermissionCode[];
    organization?: Partial<Prisma.OrganizationCreateInput>;
    user?: Partial<Prisma.UserUncheckedCreateInput>;
    password?: string;
  } = {},
) {
  const org = await createOrganization(prisma, opts.organization);

  const user = await createUserWithPassword(
    prisma,
    { organizationId: org.id, ...opts.user },
    opts.password ?? TEST_PASSWORD,
  );

  const department = await createDepartment(prisma, org.id);
  await createUserDepartment(prisma, user.id, department.id, {
    isPrimary: true,
  });

  const role = await createRole(prisma, {
    organizationId: org.id,
    createdById: user.id,
    permissionCodes: opts.permissionCodes ?? [],
    overrides: { userAssigned: 1 },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { roles: { connect: { id: role.id } } },
  });

  return {
    org,
    user,
    department,
    role,
    password: opts.password ?? TEST_PASSWORD,
  };
}

/**
 * A SECOND, unrelated tenant.
 *
 * The single most-used fixture in the suite, because "org A cannot see org B"
 * is the top cross-cutting invariant and every by-id endpoint has to be checked
 * against it. Kept as its own named helper rather than a second
 * `seedTenantWithUser()` call so a test's intent — *this row belongs to someone
 * else* — is legible at the call site.
 */
export async function seedForeignTenant(
  prisma: PrismaService,
  opts: { permissionCodes?: readonly PermissionCode[] } = {},
): Promise<SeededTenant> {
  return seedTenantWithUser(prisma, {
    permissionCodes: opts.permissionCodes,
    organization: { name: 'Foreign Tenant' },
  });
}

/**
 * Adds a member to an existing tenant, optionally holding a global system role.
 *
 * `grantSystemRole` exists because "the tenant's last Org Admin cannot be
 * deleted" and the no-escalation rule are both tested against the SEEDED global
 * roles, not against a tenant-local role that merely happens to be named the
 * same — using a look-alike would prove nothing about the real code path.
 */
export async function addMember(
  prisma: PrismaService,
  organizationId: string,
  opts: {
    user?: Partial<Prisma.UserUncheckedCreateInput>;
    roleIds?: string[];
    grantSystemRole?: SystemRoleName;
    password?: string;
  } = {},
) {
  const user = await createUserWithPassword(
    prisma,
    { organizationId, ...opts.user },
    opts.password ?? TEST_PASSWORD,
  );

  const roleIds = [...(opts.roleIds ?? [])];
  if (opts.grantSystemRole) {
    const systemRole = await findSystemRole(prisma, opts.grantSystemRole);
    roleIds.push(systemRole.id);
  }

  if (roleIds.length > 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: { roles: { connect: roleIds.map((id) => ({ id })) } },
    });
    await prisma.role.updateMany({
      where: { id: { in: roleIds } },
      data: { userAssigned: { increment: 1 } },
    });
  }

  return user;
}
