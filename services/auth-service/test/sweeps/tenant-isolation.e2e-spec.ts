import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { PERMISSION_CODES } from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest, memberContext } from '../utils';
import {
  createDeviceSession,
  createInvitation,
  seedForeignTenant,
  seedTenantWithUser,
} from '../factories';
import { DepartmentsService } from '../../src/modules/departments/departments.service';
import { RolesService } from '../../src/modules/roles/roles.service';
import { SessionsService } from '../../src/modules/sessions/sessions.service';
import { UsersService } from '../../src/modules/users/users.service';
import { InvitationsService } from '../../src/modules/invitations/invitations.service';

/**
 * The tenant-isolation sweep.
 *
 * Every by-id read and write against a resource belonging to someone else,
 * parametrized over one table rather than written per module. Adding an
 * endpoint later means adding one row here.
 *
 * **404, never 403.** A 403 says "that id exists, and it is not yours", which
 * is exactly what an attacker enumerating ids is after. 404 says nothing, and
 * is what `tenantScope()` produces naturally.
 *
 * The per-module suites cover their own routes; this file catches an endpoint
 * added WITHOUT one, because a missing row here is visible and a missing test
 * in someone else's file is not.
 */
describe('tenant isolation sweep (e2e)', () => {
  let fx: E2eFixture;

  /** Every by-id operation, with the ids resolved per-test. */
  type Probe = {
    /** `<service>.<method>`, so a failure names the exact call. */
    name: string;
    run: (
      foreign: Foreign,
      actor: ReturnType<typeof memberContext>,
    ) => Promise<unknown>;
  };

  type Foreign = {
    userId: string;
    departmentId: string;
    roleId: string;
    sessionId: string;
    invitationId: string;
  };

  let probes: Probe[];

  /**
   * Builds a tenant whose every id belongs to SOMEONE ELSE, plus a caller from
   * a different tenant holding every permission.
   *
   * The permissions matter: with a narrow set a probe could 403 on the
   * permission check and never reach the tenant filter, and the test would pass
   * having proved nothing about isolation.
   */
  const setUp = async () => {
    const mine = await seedTenantWithUser(fx.prisma);
    const theirs = await seedForeignTenant(fx.prisma);

    const { session } = await createDeviceSession(fx.prisma, theirs.user.id);
    const { row: invitation } = await createInvitation(
      fx.prisma,
      theirs.org.id,
    );

    const foreign: Foreign = {
      userId: theirs.user.id,
      departmentId: theirs.department.id,
      roleId: theirs.role.id,
      sessionId: session.id,
      invitationId: invitation.id,
    };

    return {
      foreign,
      actor: memberContext(mine.user, [...PERMISSION_CODES]),
    };
  };

  const snapshot = async (foreign: Foreign) => {
    const [user, department, role, session, invitation] = await Promise.all([
      fx.prisma.user.findUnique({ where: { id: foreign.userId } }),
      fx.prisma.department.findUnique({ where: { id: foreign.departmentId } }),
      fx.prisma.role.findUnique({ where: { id: foreign.roleId } }),
      fx.prisma.deviceSession.findUnique({ where: { id: foreign.sessionId } }),
      fx.prisma.userInvitation.findUnique({
        where: { id: foreign.invitationId },
      }),
    ]);

    return JSON.stringify({
      user: { ...user, updatedAt: undefined },
      department: { ...department, updatedAt: undefined },
      role: { ...role, updatedAt: undefined },
      session: { ...session, updatedAt: undefined },
      invitation: { ...invitation, updatedAt: undefined },
    });
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();

    const departments = fx.moduleRef.get(DepartmentsService);
    const roles = fx.moduleRef.get(RolesService);
    const sessions = fx.moduleRef.get(SessionsService);
    const users = fx.moduleRef.get(UsersService);
    const invitations = fx.moduleRef.get(InvitationsService);

    probes = [
      // -------------------------------------------------------------- users
      {
        name: 'users.getUser',
        run: (f, a) => users.getUser({ id: f.userId }, a),
      },
      {
        name: 'users.getUserPermissions',
        run: (f, a) => users.getUserPermissions({ id: f.userId }, a),
      },
      {
        name: 'users.updateUser',
        run: (f, a) => users.updateUser({ id: f.userId, fullName: 'Taken' }, a),
      },
      {
        name: 'users.deleteUser',
        run: (f, a) => users.deleteUser({ id: f.userId }, a),
      },
      {
        name: 'users.restoreUser',
        run: (f, a) => users.restoreUser({ id: f.userId }, a),
      },
      {
        name: 'users.lockUser',
        run: (f, a) => users.lockUser({ id: f.userId, reason: 'x' }, a),
      },
      {
        name: 'users.unlockUser',
        run: (f, a) => users.unlockUser({ id: f.userId }, a),
      },
      {
        name: 'users.resetUserTwoFactor',
        run: (f, a) => users.resetUserTwoFactor({ id: f.userId }, a),
      },
      {
        name: 'users.setUserRoles',
        run: (f, a) => users.setUserRoles({ id: f.userId, roleIds: [] }, a),
      },
      {
        name: 'users.setUserDepartments',
        run: (f, a) =>
          users.setUserDepartments({ id: f.userId, departments: [] }, a),
      },

      // -------------------------------------------------------- departments
      {
        name: 'departments.getDepartment',
        run: (f, a) => departments.getDepartment({ id: f.departmentId }, a),
      },
      {
        name: 'departments.updateDepartment',
        run: (f, a) =>
          departments.updateDepartment(
            { id: f.departmentId, name: 'Taken' },
            a,
          ),
      },
      {
        name: 'departments.deleteDepartment',
        run: (f, a) => departments.deleteDepartment({ id: f.departmentId }, a),
      },
      {
        name: 'departments.restoreDepartment',
        run: (f, a) => departments.restoreDepartment({ id: f.departmentId }, a),
      },
      {
        name: 'departments.listDepartmentMembers',
        run: (f, a) =>
          departments.listDepartmentMembers(
            { departmentId: f.departmentId, page: undefined },
            a,
          ),
      },
      {
        name: 'departments.addDepartmentMembers',
        run: (f, a) =>
          departments.addDepartmentMembers(
            {
              departmentId: f.departmentId,
              userIds: [f.userId],
              isPrimary: false,
            },
            a,
          ),
      },
      {
        name: 'departments.removeDepartmentMember',
        run: (f, a) =>
          departments.removeDepartmentMember(
            { departmentId: f.departmentId, userId: f.userId },
            a,
          ),
      },

      // -------------------------------------------------------------- roles
      {
        name: 'roles.getRole',
        run: (f, a) => roles.getRole({ id: f.roleId }, a),
      },
      {
        name: 'roles.updateRole',
        run: (f, a) => roles.updateRole({ id: f.roleId, name: 'Taken' }, a),
      },
      {
        name: 'roles.deleteRole',
        run: (f, a) => roles.deleteRole({ id: f.roleId }, a),
      },
      {
        name: 'roles.setRolePermissions',
        run: (f, a) =>
          roles.setRolePermissions({ id: f.roleId, permissionCodes: [] }, a),
      },

      // ----------------------------------------------------------- sessions
      {
        name: 'sessions.revokeSession',
        run: (f, a) =>
          sessions.revokeSession(
            { sessionId: f.sessionId, refreshToken: '' },
            a,
          ),
      },
      {
        name: 'sessions.revokeSessionTrust',
        run: (f, a) =>
          sessions.revokeSessionTrust(
            { sessionId: f.sessionId, refreshToken: '' },
            a,
          ),
      },
      {
        name: 'sessions.listUserSessions',
        run: (f, a) => sessions.listUserSessions({ userId: f.userId }, a),
      },
      {
        name: 'sessions.revokeUserSessions',
        run: (f, a) => sessions.revokeUserSessions({ userId: f.userId }, a),
      },

      // -------------------------------------------------------- invitations
      //
      // These take `organizationId` in the REQUEST rather than reading it off a
      // CallerContext — an older shape than the rest of the surface. The probe
      // therefore passes the CALLER's tenant with the foreign invitation id,
      // which is exactly the attack: a well-formed request naming a row that
      // belongs to someone else.
      {
        name: 'invitations.getInvitation',
        run: (f, a) =>
          invitations.getInvitation({
            invitationId: f.invitationId,
            organizationId: a.organizationId!,
          }),
      },
      {
        name: 'invitations.revokeInvitation',
        run: (f, a) =>
          invitations.revokeInvitation({
            invitationId: f.invitationId,
            organizationId: a.organizationId!,
            actorId: a.sub!,
          }),
      },
      {
        name: 'invitations.resendInvitation',
        run: (f, a) =>
          invitations.resendInvitation(
            {
              invitationId: f.invitationId,
              organizationId: a.organizationId!,
              actorId: a.sub!,
            },
            { ip: '203.0.113.1', userAgent: 'jest' },
          ),
      },
    ];
  });

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  it('every by-id operation refuses a foreign resource with NOT_FOUND, never PERMISSION_DENIED', async () => {
    const { foreign, actor } = await setUp();

    const wrong: string[] = [];

    for (const probe of probes) {
      const error: unknown = await probe.run(foreign, actor).then(
        () => new Error('resolved'),
        (e: unknown) => e,
      );

      if (!(error instanceof RpcException)) {
        wrong.push(
          `${probe.name}: RESOLVED — it returned another tenant's data`,
        );
        continue;
      }

      const code = (error.getError() as { code?: number }).code;
      if (code !== status.NOT_FOUND) {
        wrong.push(
          `${probe.name}: got ${status[code ?? -1]}, expected NOT_FOUND`,
        );
      }
    }

    // One assertion listing every offender, rather than failing on the first —
    // a sweep that stops at probe 3 hides the other twenty-five.
    expect(wrong).toEqual([]);
  });

  it('nothing was WRITTEN by any of those attempts', async () => {
    // A refused write that still mutated is the worse half of the failure, and
    // an error assertion alone would not catch it.
    const { foreign, actor } = await setUp();

    const before = await snapshot(foreign);
    for (const probe of probes) {
      await probe.run(foreign, actor).catch(() => undefined);
    }

    expect(await snapshot(foreign)).toEqual(before);
  });
});
