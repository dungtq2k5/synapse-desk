import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { PERMISSION_CODES, SystemRoleName } from '@synapsedesk/common';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { memberContext, pageRequest } from '../utils/context';
import {
  addMember,
  createRole,
  findSystemRole,
  seedForeignTenant,
  seedTenantWithUser,
} from '../factories';
import { RolesService } from '../../src/modules/roles/roles.service';

function rpcCode(error: unknown): number | undefined {
  if (!(error instanceof RpcException)) return undefined;
  return (error.getError() as { code?: number }).code;
}

async function expectRpc(promise: Promise<unknown>, code: number) {
  await expect(promise).rejects.toBeInstanceOf(RpcException);
  await promise.catch((error: unknown) => expect(rpcCode(error)).toBe(code));
}

describe('§4.2 Roles & Permissions (e2e)', () => {
  let fx: E2eFixture;
  let roles: RolesService;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    roles = fx.moduleRef.get(RolesService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  /**
   * An actor holding EVERY permission.
   *
   * The no-escalation rule means a caller can only grant what they hold, so a
   * fixture with an empty permission set could never create a role with any
   * permission at all — and every test here would fail for that reason rather
   * than the one it is about. Tests OF the rule build a narrower actor
   * deliberately.
   */
  const superuser = (t: {
    user: { id: string; organizationId: string | null };
  }) => memberContext(t.user, [...PERMISSION_CODES]);

  // ------------------------------------------------------------------ listing

  describe('listRoles', () => {
    it('1. the list is tenant roles UNION global system roles', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);

      const list = await roles.listRoles(
        { page: pageRequest(), includeSystem: true },
        superuser(t),
      );

      const names = list.items.map((r) => r.name);
      // The tenant's own role from the fixture, plus all four seeded globals.
      expect(names).toContain(t.role.name);
      expect(names).toEqual(
        expect.arrayContaining([
          SystemRoleName.ORG_ADMIN,
          SystemRoleName.KNOWLEDGE_MANAGER,
          SystemRoleName.SUPPORT_AGENT,
          SystemRoleName.END_USER,
        ]),
      );
      // And nothing belonging to anyone else.
      expect(names).not.toContain(theirs.role.name);
    });

    it("1b. includeSystem=false narrows it to the tenant's own roles", async () => {
      const t = await seedTenantWithUser(fx.prisma);

      const list = await roles.listRoles(
        { page: pageRequest(), includeSystem: false },
        superuser(t),
      );

      expect(list.items.map((r) => r.name)).toEqual([t.role.name]);
    });

    // ----------------------------------------------------------------- creation
  });

  describe('createRole', () => {
    it('3. a tenant-created role is always tenant-scoped and never a system role', async () => {
      // A global role is visible to every customer; minting one from a tenant
      // endpoint would leak a role definition across the whole platform.
      const t = await seedTenantWithUser(fx.prisma);

      const created = await roles.createRole(
        {
          name: 'Tier 2 Lead',
          description: 'Runs the escalation queue',
          permissionCodes: ['ticket.read.all'],
        },
        superuser(t),
      );

      const row = await fx.prisma.role.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.organizationId).toBe(t.org.id);
      expect(row.isSystemRole).toBe(false);
    });

    it('4. the same role name in two tenants both succeed', async () => {
      const a = await seedTenantWithUser(fx.prisma);
      const b = await seedForeignTenant(fx.prisma);

      await expect(
        roles.createRole(
          { name: 'Tier 2 Lead', description: '', permissionCodes: [] },
          superuser(a),
        ),
      ).resolves.toMatchObject({ name: 'Tier 2 Lead' });
      await expect(
        roles.createRole(
          { name: 'Tier 2 Lead', description: '', permissionCodes: [] },
          superuser(b),
        ),
      ).resolves.toMatchObject({ name: 'Tier 2 Lead' });
    });

    it('4b. a duplicate name within ONE tenant is a 409', async () => {
      const t = await seedTenantWithUser(fx.prisma);

      await roles.createRole(
        { name: 'Tier 2 Lead', description: '', permissionCodes: [] },
        superuser(t),
      );

      await expectRpc(
        roles.createRole(
          { name: 'Tier 2 Lead', description: '', permissionCodes: [] },
          superuser(t),
        ),
        status.ALREADY_EXISTS,
      );
    });

    it('an unknown permission code is rejected, not silently dropped', async () => {
      // Silently dropping it would create a role that looks right in the request
      // and grants less than the admin believes.
      const t = await seedTenantWithUser(fx.prisma);

      await expectRpc(
        roles.createRole(
          {
            name: 'Bogus',
            description: '',
            permissionCodes: ['ticket.read.all', 'not.a.real.code'],
          },
          superuser(t),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    // ---------------------------------------------------------- system roles
  });

  describe('updateRole / deleteRole — system roles', () => {
    it('2. a system role cannot be renamed or deleted, enforced in the SERVICE', async () => {
      // Not merely hidden in the UI: the global roles are shared by every tenant,
      // so one tenant renaming "Org Admin" would rename it for everyone.
      const t = await seedTenantWithUser(fx.prisma);
      const systemRole = await findSystemRole(
        fx.prisma,
        SystemRoleName.ORG_ADMIN,
      );

      await expectRpc(
        roles.updateRole({ id: systemRole.id, name: 'Hijacked' }, superuser(t)),
        status.PERMISSION_DENIED,
      );
      await expectRpc(
        roles.deleteRole({ id: systemRole.id }, superuser(t)),
        status.PERMISSION_DENIED,
      );
      await expectRpc(
        roles.setRolePermissions(
          { id: systemRole.id, permissionCodes: [] },
          superuser(t),
        ),
        status.PERMISSION_DENIED,
      );

      const unchanged = await fx.prisma.role.findUniqueOrThrow({
        where: { id: systemRole.id },
      });
      expect(unchanged.name).toBe(SystemRoleName.ORG_ADMIN);
    });

    // ----------------------------------------------------------------- deletion
  });

  describe('deleteRole', () => {
    it('5. deleting a role with holders is a 409 — no silent cascade', async () => {
      // Roles are HARD-deleted, so `user_roles` cascades away with them. This
      // guard is the only thing between a mis-click and stripping a role from
      // forty people — a permission change nobody authorised and nothing records
      // well enough to undo.
      const t = await seedTenantWithUser(fx.prisma);

      const error = await roles
        .deleteRole({ id: t.role.id }, superuser(t))
        .catch((e: unknown) => e);

      expect(rpcCode(error)).toBe(status.ABORTED);
      expect((error as RpcException).getError()).toMatchObject({
        message: expect.stringContaining('1 user'),
      });
      expect(
        await fx.prisma.role.findUnique({ where: { id: t.role.id } }),
      ).not.toBeNull();
    });

    it('5b. an unheld role deletes cleanly', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const spare = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });

      await roles.deleteRole({ id: spare.id }, superuser(t));

      expect(
        await fx.prisma.role.findUnique({ where: { id: spare.id } }),
      ).toBeNull();
    });

    it("another tenant's role is 404 for every operation", async () => {
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);

      await expectRpc(
        roles.getRole({ id: theirs.role.id }, superuser(mine)),
        status.NOT_FOUND,
      );
      await expectRpc(
        roles.updateRole(
          { id: theirs.role.id, name: 'Taken' },
          superuser(mine),
        ),
        status.NOT_FOUND,
      );
      await expectRpc(
        roles.deleteRole({ id: theirs.role.id }, superuser(mine)),
        status.NOT_FOUND,
      );
    });

    // ------------------------------------------------------------- permissions
  });

  describe('setRolePermissions', () => {
    it('setRolePermissions REPLACES rather than adds', async () => {
      // `set`, not `connect`: sending the same body twice must be a no-op, and a
      // code left out must genuinely be revoked.
      const t = await seedTenantWithUser(fx.prisma);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
        permissionCodes: ['ticket.read.all', 'document.read'],
      });

      const updated = await roles.setRolePermissions(
        { id: role.id, permissionCodes: ['document.read'] },
        superuser(t),
      );

      expect(updated.permissionCodes).toEqual(['document.read']);
    });

    it('6. setRolePermissions applies the SAME no-escalation rule', async () => {
      // Second enforcement point for the same rule, and an independent code path
      // — without this an actor could create a harmless role and then widen it.
      const t = await seedTenantWithUser(fx.prisma);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });

      const limitedActor = memberContext(t.user, ['role.update', 'role.read']);

      await expectRpc(
        roles.setRolePermissions(
          { id: role.id, permissionCodes: ['organization.update'] },
          limitedActor,
        ),
        status.PERMISSION_DENIED,
      );

      const unchanged = await fx.prisma.role.findUniqueOrThrow({
        where: { id: role.id },
        include: { permissions: true },
      });
      expect(unchanged.permissions).toHaveLength(0);
    });

    it('6b. createRole applies it too', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const limitedActor = memberContext(t.user, ['role.create']);

      await expectRpc(
        roles.createRole(
          {
            name: 'Escalation',
            description: '',
            permissionCodes: ['organization.update'],
          },
          limitedActor,
        ),
        status.PERMISSION_DENIED,
      );
    });

    it('6c. granting exactly what the actor holds is allowed', async () => {
      // The rule is "no MORE than you hold", not "nothing at all" — otherwise
      // delegation is impossible and the permission is useless.
      const t = await seedTenantWithUser(fx.prisma);
      const actor = memberContext(t.user, ['role.create', 'document.read']);

      await expect(
        roles.createRole(
          {
            name: 'Reader',
            description: '',
            permissionCodes: ['document.read'],
          },
          actor,
        ),
      ).resolves.toMatchObject({ permissionCodes: ['document.read'] });
    });
  });

  describe('listPermissions', () => {
    it('7. every permission carries a group derived from its code prefix', async () => {
      // Derived, not stored — which is what lets the role editor render sections
      // without a column that could disagree with the code it is grouping.
      const result = await roles.listPermissions();

      expect(result.items.map((p) => p.code).sort()).toEqual(
        [...PERMISSION_CODES].sort(),
      );

      for (const permission of result.items) {
        expect(permission.code.startsWith(`${permission.group}.`)).toBe(true);
      }

      // And the grouping is genuinely coarser than the codes: `ticket.read.all`
      // and `ticket.create` land together.
      const groups = new Set(result.items.map((p) => p.group));
      expect(groups.size).toBeLessThan(result.items.length);
      expect(groups).toContain('ticket');
    });

    it('7b. there is no tenant-facing way to mint a permission', async () => {
      // PERMISSION_CODES in libs/common is the source of truth and the table is
      // seeded from it. A code created through an API is one no
      // `@RequirePermission` can reference and no `PermissionCode` type knows
      // about.
      expect(await fx.prisma.permission.count()).toBe(PERMISSION_CODES.length);
      expect('createPermission' in roles).toBe(false);
    });

    // ---------------------------------------------------- user role assignment
  });

  describe('grantRoles / releaseUserRoles', () => {
    it('grantRoles bumps the counter without the checks — invitation acceptance only', async () => {
      // The one path that cannot supply an actor to check against. It exists so
      // the counter is still maintained there; every administrative path must use
      // `setUserRoles` instead.
      const t = await seedTenantWithUser(fx.prisma);
      const joiner = await addMember(fx.prisma, t.org.id);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });

      await fx.prisma.$transaction((tx) =>
        roles.grantRoles(tx, joiner.id, [role.id]),
      );

      const after = await fx.prisma.role.findUniqueOrThrow({
        where: { id: role.id },
      });
      expect(after.userAssigned).toBe(1);
    });

    it('releaseUserRoles decrements every role a departing user held', async () => {
      const t = await seedTenantWithUser(fx.prisma);

      await fx.prisma.$transaction((tx) =>
        roles.releaseUserRoles(tx, t.user.id),
      );

      const after = await fx.prisma.role.findUniqueOrThrow({
        where: { id: t.role.id },
      });
      expect(after.userAssigned).toBe(0);
      expect(
        await fx.prisma.user.findUniqueOrThrow({
          where: { id: t.user.id },
          include: { roles: true },
        }),
      ).toMatchObject({ roles: [] });
    });
  });
});
