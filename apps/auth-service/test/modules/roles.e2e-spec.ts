import { RpcException } from '@nestjs/microservices';
import { expectRpc, rpcCode } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import {
  compareAlphabetically,
  PERMISSION_CODES,
  SystemRoleName,
} from '@synapsedesk/common';
import {
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
  pageRequest,
  superuser,
} from '../utils';
import {
  addMember,
  createRole,
  findSystemRole,
  seedForeignTenant,
  seedTenantWithUser,
} from '../factories';
import { RolesService } from '../../src/modules/roles/roles.service';

describe('Roles & Permissions (e2e)', () => {
  let fx: E2eFixture;
  let roles: RolesService;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    roles = fx.moduleRef.get(RolesService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

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
  });

  // ----------------------------------------------------------------- creation

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
  });

  // ---------------------------------------------------------- system roles

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
  });

  // ----------------------------------------------------------------- deletion

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
  });

  // ------------------------------------------------------------- permissions

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

      expect(
        result.items.map((p) => p.code).sort(compareAlphabetically),
      ).toEqual([...PERMISSION_CODES].sort(compareAlphabetically));

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
  });

  // ---------------------------------------------------- user role assignment

  describe('assignRoleUsers / revokeRoleUser', () => {
    it('**1. assigning a role a user ALREADY holds does not move the counter**', async () => {
      // `connect` is idempotent and `increment` is not, so counting the request
      // rather than the delta is how `user_assigned` drifts high — and a high
      // counter blocks `DELETE /roles/:id` forever, with no UI that can explain
      // why.
      const t = await seedTenantWithUser(fx.prisma);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });
      const member = await addMember(fx.prisma, t.org.id);

      await roles.assignRoleUsers(
        { roleId: role.id, userIds: [member.id] },
        superuser(t),
      );
      const once = await fx.prisma.role.findUniqueOrThrow({
        where: { id: role.id },
      });

      // Again, same user.
      const twice = await roles.assignRoleUsers(
        { roleId: role.id, userIds: [member.id] },
        superuser(t),
      );

      expect(once.userAssigned).toBe(1);
      expect(twice.userAssigned).toBe(1);
    });

    it('**2. three users where one already holds it increments by exactly two**', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });
      const [a, b, c] = await Promise.all([
        addMember(fx.prisma, t.org.id),
        addMember(fx.prisma, t.org.id),
        addMember(fx.prisma, t.org.id),
      ]);
      await roles.assignRoleUsers(
        { roleId: role.id, userIds: [a.id] },
        superuser(t),
      );

      const after = await roles.assignRoleUsers(
        { roleId: role.id, userIds: [a.id, b.id, c.id] },
        superuser(t),
      );

      expect(after.userAssigned).toBe(3);
    });

    it('**3. a batch containing another tenant’s user fails WHOLE**', async () => {
      // The check reuse does not supply: `setUserRoles` takes a userId and
      // never validates it. A partial bulk cannot be diagnosed without
      // re-reading, and the obvious retry re-applies the half that worked.
      const t = await seedTenantWithUser(fx.prisma);
      const stranger = await seedForeignTenant(fx.prisma);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });
      const mine = await addMember(fx.prisma, t.org.id);

      await expectRpc(
        roles.assignRoleUsers(
          { roleId: role.id, userIds: [mine.id, stranger.user.id] },
          superuser(t),
        ),
        status.NOT_FOUND,
      );

      // Nothing written — not even the half that was legitimate.
      const after = await fx.prisma.role.findUniqueOrThrow({
        where: { id: role.id },
      });
      expect(after.userAssigned).toBe(0);
    });

    it('4. revoking decrements, and the role comes back with the new count', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });
      const member = await addMember(fx.prisma, t.org.id);
      await roles.assignRoleUsers(
        { roleId: role.id, userIds: [member.id] },
        superuser(t),
      );

      const after = await roles.revokeRoleUser(
        { roleId: role.id, userId: member.id },
        superuser(t),
      );

      expect(after.userAssigned).toBe(0);
    });

    it('**5. revoking a role the user does not hold is NOT_FOUND**', async () => {
      // "It was already gone" and "I removed it" must not look the same to an
      // audit reader.
      const t = await seedTenantWithUser(fx.prisma);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });
      const member = await addMember(fx.prisma, t.org.id);

      await expectRpc(
        roles.revokeRoleUser(
          { roleId: role.id, userId: member.id },
          superuser(t),
        ),
        status.NOT_FOUND,
      );
    });

    it('**6. revoking ORG_ADMIN from the last admin is refused**', async () => {
      // The route that NAMES the operation. It inherits the guard because the
      // write goes through `setUserRoles`, which is where the guard lives —
      // walking around that primitive would have left this path unguarded.
      const t = await seedTenantWithUser(fx.prisma);
      const onlyAdmin = await addMember(fx.prisma, t.org.id, {
        grantSystemRole: SystemRoleName.ORG_ADMIN,
      });
      const orgAdmin = await findSystemRole(
        fx.prisma,
        SystemRoleName.ORG_ADMIN,
      );

      await expectRpc(
        roles.revokeRoleUser(
          { roleId: orgAdmin.id, userId: onlyAdmin.id },
          superuser(t),
        ),
        status.ABORTED,
      );

      const after = await fx.prisma.user.findUniqueOrThrow({
        where: { id: onlyAdmin.id },
        include: { roles: { select: { name: true } } },
      });
      expect(after.roles.map((role) => role.name)).toContain(
        String(SystemRoleName.ORG_ADMIN),
      );
    });

    it('**7. a bulk assign writes one audit row PER USER, with before/after**', async () => {
      // A row whose resource is the ROLE and whose metadata is twenty user ids
      // cannot answer "when did this user get this role".
      const t = await seedTenantWithUser(fx.prisma);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });
      const [a, b] = await Promise.all([
        addMember(fx.prisma, t.org.id),
        addMember(fx.prisma, t.org.id),
      ]);
      fx.audit.record.mockClear();

      await roles.assignRoleUsers(
        { roleId: role.id, userIds: [a.id, b.id] },
        superuser(t),
      );

      const events = fx.audit.record.mock.calls.map(
        ([, event]: [unknown, { action: string; resourceId: string }]) => event,
      );
      expect(events).toHaveLength(2);
      expect(
        events.map((event) => event.resourceId).sort(compareAlphabetically),
      ).toEqual([a.id, b.id].sort(compareAlphabetically));
      expect(events[0].action).toBe('USER_ROLES_UPDATED');
    });

    it('**7b. `before` is the set the transaction actually replaced**', async () => {
      // The testable half of "read inside the transaction". The concurrent
      // interleave itself is NOT deterministically testable here — there is no
      // seam to suspend between the read and the write inside
      // `assignRoleUsers`, and a timing race would be flaky and deleted. What a
      // regression DOES show up as is a `before` that disagrees with the row
      // state the write replaced.
      const t = await seedTenantWithUser(fx.prisma);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });
      const other = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });
      const member = await addMember(fx.prisma, t.org.id);
      // Give them a role first, so `before` is non-empty and an omission shows.
      await roles.assignRoleUsers(
        { roleId: other.id, userIds: [member.id] },
        superuser(t),
      );
      fx.audit.record.mockClear();

      await roles.assignRoleUsers(
        { roleId: role.id, userIds: [member.id] },
        superuser(t),
      );

      const [[, event]] = fx.audit.record.mock.calls as [
        [unknown, { metadata: { before: string[]; after: string[] } }],
      ];
      expect(event.metadata.before).toEqual([other.id]);
      expect([...event.metadata.after].sort(compareAlphabetically)).toEqual(
        [other.id, role.id].sort(compareAlphabetically),
      );

      // And the row agrees: the pre-existing role SURVIVED the replacement.
      const after = await fx.prisma.user.findUniqueOrThrow({
        where: { id: member.id },
        include: { roles: { select: { id: true } } },
      });
      expect(
        after.roles.map((held) => held.id).sort(compareAlphabetically),
      ).toEqual([other.id, role.id].sort(compareAlphabetically));
    });

    it('**7c. revoking leaves the user’s OTHER roles alone**', async () => {
      // Subtractive, not replace: the caller named one role and said nothing
      // about the rest.
      const t = await seedTenantWithUser(fx.prisma);
      const going = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });
      const staying = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });
      const member = await addMember(fx.prisma, t.org.id);
      await roles.assignRoleUsers(
        { roleId: going.id, userIds: [member.id] },
        superuser(t),
      );
      await roles.assignRoleUsers(
        { roleId: staying.id, userIds: [member.id] },
        superuser(t),
      );

      await roles.revokeRoleUser(
        { roleId: going.id, userId: member.id },
        superuser(t),
      );

      const after = await fx.prisma.user.findUniqueOrThrow({
        where: { id: member.id },
        include: { roles: { select: { id: true } } },
      });
      expect(after.roles.map((held) => held.id)).toEqual([staying.id]);
      // And only the revoked role's counter moved.
      const stayingRow = await fx.prisma.role.findUniqueOrThrow({
        where: { id: staying.id },
      });
      expect(stayingRow.userAssigned).toBe(1);
    });

    it('**7d. no-escalation applies, and the refusal NAMES the user**', async () => {
      // `assertGrantable` runs over each user's WHOLE resulting set, not the
      // delta — so one existing holder of a wider role can refuse a batch about
      // users the caller was not trying to change. The primitive's message
      // lists permission codes only, which reads as a bug unless it says WHO.
      const t = await seedTenantWithUser(fx.prisma);
      const wide = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
        permissionCodes: ['organization.update'],
      });
      const member = await addMember(fx.prisma, t.org.id);
      const limitedActor = memberContext(t.user, ['user.role.assign']);

      const refusal = roles.assignRoleUsers(
        { roleId: wide.id, userIds: [member.id] },
        limitedActor,
      );

      await expectRpc(refusal, status.PERMISSION_DENIED);
      await expect(refusal).rejects.toMatchObject({
        message: expect.stringContaining(member.id) as string,
      });

      // And nothing was written — the batch rolls back whole.
      const after = await fx.prisma.role.findUniqueOrThrow({
        where: { id: wide.id },
      });
      expect(after.userAssigned).toBe(0);
    });

    it('8. a user who already held the role gets NO audit row', async () => {
      // Nothing changed, so there is nothing to record — a row saying "before
      // and after are identical" is noise in a trail read for changes.
      const t = await seedTenantWithUser(fx.prisma);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });
      const member = await addMember(fx.prisma, t.org.id);
      await roles.assignRoleUsers(
        { roleId: role.id, userIds: [member.id] },
        superuser(t),
      );
      fx.audit.record.mockClear();

      await roles.assignRoleUsers(
        { roleId: role.id, userIds: [member.id] },
        superuser(t),
      );

      expect(fx.audit.record).not.toHaveBeenCalled();
    });
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
