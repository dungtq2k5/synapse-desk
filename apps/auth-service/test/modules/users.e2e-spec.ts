import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { compareAlphabetically, SystemRoleName } from '@synapsedesk/common';
import {
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
  superuser,
} from '../utils';
import {
  addMember,
  createDepartment,
  createRole,
  createTrustedDeviceSession,
  createUserWithPassword,
  findSystemRole,
  seedForeignTenant,
  seedTenantWithUser,
} from '../factories';
import { UsersService } from '../../src/modules/users/users.service';
import { flattenPermissionCodes } from '../../src/common/utils';

describe('Users (e2e)', () => {
  let fx: E2eFixture;
  let users: UsersService;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    users = fx.moduleRef.get(UsersService);
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  // ------------------------------------------------------------- permissions

  describe('getUserPermissions', () => {
    it('2. getUserPermissions computes what the JWT claim would', async () => {
      // Both must call the same extracted function — this is the guard against
      // the admin view and the token ever disagreeing about what someone can do,
      // which is the hardest class of authorization bug to notice.
      const t = await seedTenantWithUser(fx.prisma, {
        permissionCodes: ['document.read', 'ticket.read.all'],
      });

      const viaService = await users.getUserPermissions(
        { id: t.user.id },
        superuser(t),
      );

      const rows = await fx.prisma.user.findUniqueOrThrow({
        where: { id: t.user.id },
        select: { roles: { include: { permissions: true } } },
      });
      const viaClaimBuilder = flattenPermissionCodes(rows.roles);

      expect(
        [...viaService.permissionCodes].sort(compareAlphabetically),
      ).toEqual([...viaClaimBuilder].sort(compareAlphabetically));
    });

    it('2b. a foreign user 404s rather than leaking a permission set', async () => {
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);

      await expectRpc(
        users.getUserPermissions({ id: theirs.user.id }, superuser(mine)),
        status.NOT_FOUND,
      );
    });

    // ------------------------------------------------------------------ create
  });

  describe('createUser', () => {
    it('3. direct create is seat-gated by the SAME counter as invitations', async () => {
      // A create rejected here must not contradict what the usage page reports.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { maxAgentSeats: 2 },
      });
      await addMember(fx.prisma, t.org.id); // seats: 2 of 2

      await expectRpc(
        users.createUser(
          {
            email: 'overflow@seats.test',
            fullName: 'Overflow',
            roleIds: [],
            departmentIds: [],
          },
          superuser(t),
        ),
        status.RESOURCE_EXHAUSTED,
      );
    });

    it('3b. a created account has no password and is not verified', async () => {
      // The honest state: nobody has proved they hold the address, and an
      // admin-chosen password would have to reach the human out of band anyway.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { maxAgentSeats: 50 },
      });

      const result = await users.createUser(
        {
          email: 'fresh@create.test',
          fullName: 'Fresh',
          roleIds: [],
          departmentIds: [],
        },
        superuser(t),
      );

      const row = await fx.prisma.user.findUniqueOrThrow({
        where: { id: result.user!.user!.id },
      });
      expect(row.passwordHash).toBeNull();
      expect(row.isEmailVerified).toBe(false);
    });

    it('3c. a created account with no roles given defaults to End User', async () => {
      // Never zero roles: the End User role grants nothing, but existing means
      // every account has something to carry.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { maxAgentSeats: 50 },
      });

      const result = await users.createUser(
        {
          email: 'defaulted@create.test',
          fullName: 'Defaulted',
          roleIds: [],
          departmentIds: [],
        },
        superuser(t),
      );

      const row = await fx.prisma.user.findUniqueOrThrow({
        where: { id: result.user!.user!.id },
        include: { roles: true },
      });
      expect(row.roles.map((r) => r.name)).toEqual([SystemRoleName.END_USER]);
    });

    // ------------------------------------------------------------------ delete
  });

  describe('deleteUser', () => {
    it('5. delete revokes every session for the target', async () => {
      // The gap the remaining-work doc named as a real risk: without this an
      // access token issued a second earlier keeps working until it expires.
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      await createTrustedDeviceSession(fx.prisma, target.id);
      await createTrustedDeviceSession(fx.prisma, target.id);

      const result = await users.deleteUser({ id: target.id }, superuser(t));

      expect(result.revokedSessionCount).toBe(2);
      expect(
        await fx.prisma.deviceSession.count({ where: { userId: target.id } }),
      ).toBe(0);
    });

    it('5b. delete releases their roles so user_assigned reflects reality', async () => {
      // A deactivated user is not occupying the role, and leaving the count
      // inflated blocks a legitimate role delete forever.
      const t = await seedTenantWithUser(fx.prisma);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });
      const target = await addMember(fx.prisma, t.org.id, {
        roleIds: [role.id],
      });

      expect(
        (await fx.prisma.role.findUniqueOrThrow({ where: { id: role.id } }))
          .userAssigned,
      ).toBe(1);

      await users.deleteUser({ id: target.id }, superuser(t));

      expect(
        (await fx.prisma.role.findUniqueOrThrow({ where: { id: role.id } }))
          .userAssigned,
      ).toBe(0);
    });

    it('6. deleting yourself is a 409', async () => {
      const t = await seedTenantWithUser(fx.prisma);

      await expectRpc(
        users.deleteUser({ id: t.user.id }, superuser(t)),
        status.ABORTED,
      );
    });

    it('7. deleting the LAST Org Admin is a 409', async () => {
      // Otherwise the tenant becomes unadministrable with no in-product way back
      // — the same failure the founder-role rule prevents, reached from the
      // other direction.
      const t = await seedTenantWithUser(fx.prisma);
      const onlyAdmin = await addMember(fx.prisma, t.org.id, {
        grantSystemRole: SystemRoleName.ORG_ADMIN,
      });

      await expectRpc(
        users.deleteUser({ id: onlyAdmin.id }, superuser(t)),
        status.ABORTED,
      );
    });

    it('7b. with a second Org Admin present, the first can go', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const first = await addMember(fx.prisma, t.org.id, {
        grantSystemRole: SystemRoleName.ORG_ADMIN,
      });
      await addMember(fx.prisma, t.org.id, {
        grantSystemRole: SystemRoleName.ORG_ADMIN,
      });

      await expect(
        users.deleteUser({ id: first.id }, superuser(t)),
      ).resolves.toBeDefined();
    });

    it('7c. a LOCKED Org Admin does not count as cover', async () => {
      // They cannot sign in, so treating them as an administrator would let the
      // last usable one be removed.
      const t = await seedTenantWithUser(fx.prisma);
      const active = await addMember(fx.prisma, t.org.id, {
        grantSystemRole: SystemRoleName.ORG_ADMIN,
      });
      // Not assigned: the ROW is the fixture — the whole point of the test is
      // that this admin does not count, so nothing here refers to it again.
      await addMember(fx.prisma, t.org.id, {
        grantSystemRole: SystemRoleName.ORG_ADMIN,
        user: { isLocked: true },
      });

      await expectRpc(
        users.deleteUser({ id: active.id }, superuser(t)),
        status.ABORTED,
      );
    });
  });

  describe('lockUser', () => {
    it('8. lock has the same session-revocation property as delete', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      await createTrustedDeviceSession(fx.prisma, target.id);

      await users.lockUser(
        { id: target.id, reason: 'Suspected compromise' },
        superuser(t),
      );

      expect(
        await fx.prisma.deviceSession.count({ where: { userId: target.id } }),
      ).toBe(0);
      expect(
        (await fx.prisma.user.findUniqueOrThrow({ where: { id: target.id } }))
          .isLocked,
      ).toBe(true);
    });
  });

  describe('restoreUser', () => {
    it('17. restoring into a now-taken address is a 409, not a 500', async () => {
      // Clearing `deleted_at` re-enters `users_org_email_key`, which is partial
      // on `deleted_at IS NULL` — someone may have taken the address meanwhile.
      const t = await seedTenantWithUser(fx.prisma, {
        organization: { maxAgentSeats: 50 },
      });
      const leaver = await addMember(fx.prisma, t.org.id, {
        user: { email: 'reused@restore.test' },
      });

      await users.deleteUser({ id: leaver.id }, superuser(t));
      await createUserWithPassword(fx.prisma, {
        email: 'reused@restore.test',
        organizationId: t.org.id,
      });

      await expectRpc(
        users.restoreUser({ id: leaver.id }, superuser(t)),
        status.ALREADY_EXISTS,
      );
    });

    it('17b. restoring when the address is free succeeds, with no sessions back', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const leaver = await addMember(fx.prisma, t.org.id);
      await createTrustedDeviceSession(fx.prisma, leaver.id);

      await users.deleteUser({ id: leaver.id }, superuser(t));
      const restored = await users.restoreUser({ id: leaver.id }, superuser(t));

      expect(restored.user!.id).toBe(leaver.id);
      // They sign in again — a restored account must not resume a session that
      // was revoked as part of offboarding them.
      expect(
        await fx.prisma.deviceSession.count({ where: { userId: leaver.id } }),
      ).toBe(0);
    });

    // -------------------------------------------------------------------- 2FA
  });

  describe('resetUserTwoFactor', () => {
    it('9. resetting 2FA clears the secret, the codes AND every trusted device', async () => {
      // Leaving `device_token_hash` alive defeats the whole point: the device the
      // reset exists to lock out would still skip the challenge.
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id, {
        user: { isTwoFactorEnabled: true, twoFactorSecret: 'stub-secret' },
      });
      await createTrustedDeviceSession(fx.prisma, target.id);
      await fx.prisma.twoFactorBackupCode.create({
        data: {
          userId: target.id,
          codeHash: 'stub-hash',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      await users.resetUserTwoFactor({ id: target.id }, superuser(t));

      const row = await fx.prisma.user.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(row.isTwoFactorEnabled).toBe(false);
      expect(row.twoFactorSecret).toBeNull();
      expect(
        await fx.prisma.twoFactorBackupCode.count({
          where: { userId: target.id },
        }),
      ).toBe(0);
      expect(
        await fx.prisma.deviceSession.count({
          where: { userId: target.id, deviceTokenHash: { not: null } },
        }),
      ).toBe(0);
    });

    // ------------------------------------------------------------------- roles
  });

  describe('setUserRoles', () => {
    it('10. a role id from another tenant is rejected', async () => {
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);
      const target = await addMember(fx.prisma, mine.org.id);

      await expectRpc(
        users.setUserRoles(
          { id: target.id, roleIds: [theirs.role.id] },
          superuser(mine),
        ),
        status.NOT_FOUND,
      );
    });

    it('10b. a GLOBAL system role IS accepted', async () => {
      // The other branch, and it fails independently: checking only tenant roles
      // would block every legitimate system-role assignment.
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      const systemRole = await findSystemRole(
        fx.prisma,
        SystemRoleName.SUPPORT_AGENT,
      );

      await expect(
        users.setUserRoles(
          { id: target.id, roleIds: [systemRole.id] },
          superuser(t),
        ),
      ).resolves.toBeDefined();
    });

    it('11. the junction write and the counter move in ONE transaction', async () => {
      // Forced failure after the junction write: the counter must not be left
      // ahead of it. A duplicate role id in the list makes `setUserRoles` throw
      // after it has already computed the diff.
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });

      const before = await fx.prisma.role.findUniqueOrThrow({
        where: { id: role.id },
      });

      await expectRpc(
        users.setUserRoles(
          {
            id: target.id,
            roleIds: [role.id, '00000000-0000-4000-8000-000000000000'],
          },
          superuser(t),
        ),
        status.NOT_FOUND,
      );

      const after = await fx.prisma.role.findUniqueOrThrow({
        where: { id: role.id },
      });
      expect(after.userAssigned).toBe(before.userAssigned);
      expect(
        await fx.prisma.user.findUniqueOrThrow({
          where: { id: target.id },
          include: { roles: true },
        }),
      ).toMatchObject({ roles: [] });
    });

    it('12. the same body twice leaves user_assigned unchanged', async () => {
      // The easiest way this bug ships is a naive `increment` on every call.
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });

      await users.setUserRoles(
        { id: target.id, roleIds: [role.id] },
        superuser(t),
      );
      const afterFirst = await fx.prisma.role.findUniqueOrThrow({
        where: { id: role.id },
      });

      await users.setUserRoles(
        { id: target.id, roleIds: [role.id] },
        superuser(t),
      );
      const afterSecond = await fx.prisma.role.findUniqueOrThrow({
        where: { id: role.id },
      });

      expect(afterFirst.userAssigned).toBe(1);
      expect(afterSecond.userAssigned).toBe(1);
    });

    it('12b. removing a role decrements it', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
      });

      await users.setUserRoles(
        { id: target.id, roleIds: [role.id] },
        superuser(t),
      );
      await users.setUserRoles({ id: target.id, roleIds: [] }, superuser(t));

      expect(
        (await fx.prisma.role.findUniqueOrThrow({ where: { id: role.id } }))
          .userAssigned,
      ).toBe(0);
    });

    it('13. an actor cannot grant a permission they do not hold', async () => {
      // The no-escalation rule. Without it, anyone with `user.role.assign` is one
      // request away from granting themselves Org Admin — which makes that
      // permission equivalent to full tenant control.
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      const powerfulRole = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
        permissionCodes: ['organization.update'],
      });

      const limitedActor = memberContext(t.user, [
        'user.role.assign',
        'user.read',
      ]);

      await expectRpc(
        users.setUserRoles(
          { id: target.id, roleIds: [powerfulRole.id] },
          limitedActor,
        ),
        status.PERMISSION_DENIED,
      );

      expect(
        await fx.prisma.user.findUniqueOrThrow({
          where: { id: target.id },
          include: { roles: true },
        }),
      ).toMatchObject({ roles: [] });
    });

    it('13b. an actor CAN grant a role whose permissions they hold', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      const role = await createRole(fx.prisma, {
        organizationId: t.org.id,
        createdById: t.user.id,
        permissionCodes: ['document.read'],
      });

      const actor = memberContext(t.user, [
        'user.role.assign',
        'document.read',
      ]);

      await expect(
        users.setUserRoles({ id: target.id, roleIds: [role.id] }, actor),
      ).resolves.toBeDefined();
    });

    // ------------------------------------------------------------- departments
  });

  describe('setUserDepartments', () => {
    it('14. ZERO primaries in a non-empty set is a 400', async () => {
      // Zero is as invalid as two: the partial unique index only catches "two",
      // so a submission with no primary would be accepted and silently leave the
      // user with no ticket routing and no document scope.
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      const a = await createDepartment(fx.prisma, t.org.id);
      const b = await createDepartment(fx.prisma, t.org.id);

      await expectRpc(
        users.setUserDepartments(
          {
            id: target.id,
            departments: [
              { departmentId: a.id, isPrimary: false },
              { departmentId: b.id, isPrimary: false },
            ],
          },
          superuser(t),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('15. TWO primaries is a 400', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      const a = await createDepartment(fx.prisma, t.org.id);
      const b = await createDepartment(fx.prisma, t.org.id);

      await expectRpc(
        users.setUserDepartments(
          {
            id: target.id,
            departments: [
              { departmentId: a.id, isPrimary: true },
              { departmentId: b.id, isPrimary: true },
            ],
          },
          superuser(t),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('15b. exactly one primary is accepted', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      const a = await createDepartment(fx.prisma, t.org.id);
      const b = await createDepartment(fx.prisma, t.org.id);

      await users.setUserDepartments(
        {
          id: target.id,
          departments: [
            { departmentId: a.id, isPrimary: true },
            { departmentId: b.id, isPrimary: false },
          ],
        },
        superuser(t),
      );

      const rows = await fx.prisma.userDepartment.findMany({
        where: { userId: target.id },
      });
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
    });

    it('15c. an EMPTY set is allowed — a user may belong to no department', async () => {
      const t = await seedTenantWithUser(fx.prisma);
      const target = await addMember(fx.prisma, t.org.id);
      const dept = await createDepartment(fx.prisma, t.org.id);

      await users.setUserDepartments(
        {
          id: target.id,
          departments: [{ departmentId: dept.id, isPrimary: true }],
        },
        superuser(t),
      );
      await users.setUserDepartments(
        { id: target.id, departments: [] },
        superuser(t),
      );

      expect(
        await fx.prisma.userDepartment.count({ where: { userId: target.id } }),
      ).toBe(0);
    });

    it('a department from another tenant is rejected', async () => {
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);
      const target = await addMember(fx.prisma, mine.org.id);

      await expectRpc(
        users.setUserDepartments(
          {
            id: target.id,
            departments: [
              { departmentId: theirs.department.id, isPrimary: true },
            ],
          },
          superuser(mine),
        ),
        status.NOT_FOUND,
      );
    });

    // ------------------------------------------------------------ own profile
  });

  describe('updateOwnProfile', () => {
    it('16. updateOwnProfile writes only the fields it is given', async () => {
      const t = await seedTenantWithUser(fx.prisma);

      const before = await fx.prisma.user.findUniqueOrThrow({
        where: { id: t.user.id },
      });

      // The target is the CALLER, taken from the context — there is no user id
      // in the request, which is what makes this endpoint unable to edit anyone
      // else no matter what a client sends.
      await users.updateOwnProfile(
        { fullName: 'Renamed Person' },
        memberContext(t.user),
      );

      const after = await fx.prisma.user.findUniqueOrThrow({
        where: { id: t.user.id },
      });
      expect(after.fullName).toBe('Renamed Person');
      // Nothing privileged moved with it.
      expect(after.email).toBe(before.email);
      expect(after.isEmailVerified).toBe(before.isEmailVerified);
      expect(after.isSuperAdmin).toBe(before.isSuperAdmin);
      expect(after.isLocked).toBe(before.isLocked);
    });
  });

  describe('getCurrentUser / getUser', () => {
    it('1. no response ever carries passwordHash or twoFactorSecret', async () => {
      // Asserted on the actual JSON keys, not on a mapper's intent.
      const t = await seedTenantWithUser(fx.prisma, {
        user: { isTwoFactorEnabled: true, twoFactorSecret: 'super-secret' },
      });

      const current = await users.getCurrentUser(t.user.id);
      const single = await users.getUser({ id: t.user.id }, superuser(t));

      for (const payload of [current, single]) {
        const json = JSON.stringify(payload);
        expect(json).not.toMatch(/passwordHash|twoFactorSecret/);
        expect(json).not.toContain('super-secret');
      }
    });

    it('a foreign user is 404 for every by-id operation', async () => {
      const mine = await seedTenantWithUser(fx.prisma);
      const theirs = await seedForeignTenant(fx.prisma);

      await expectRpc(
        users.getUser({ id: theirs.user.id }, superuser(mine)),
        status.NOT_FOUND,
      );
      await expectRpc(
        users.updateUser(
          { id: theirs.user.id, fullName: 'X' },
          superuser(mine),
        ),
        status.NOT_FOUND,
      );
      await expectRpc(
        users.deleteUser({ id: theirs.user.id }, superuser(mine)),
        status.NOT_FOUND,
      );
      await expectRpc(
        users.lockUser({ id: theirs.user.id, reason: 'x' }, superuser(mine)),
        status.NOT_FOUND,
      );

      expect(
        (
          await fx.prisma.user.findUniqueOrThrow({
            where: { id: theirs.user.id },
          })
        ).isLocked,
      ).toBe(false);
    });
  });
});
