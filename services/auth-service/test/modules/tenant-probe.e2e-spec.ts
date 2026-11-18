import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pageRequest } from '@synapsedesk/grpc-proto/testing/page';
import {
  CLEAN,
  controllerCall,
  type IdTakingMethod,
  idTakingMethods,
  probeCall,
  superAdminReach,
  snapshot,
  tenantIdentifiers,
  wireRequest,
} from '@synapsedesk/grpc-proto/testing/tenant-probe';
import { E2eFixture, bootstrapE2eTest } from '../utils/bootstrap';
import { superuser } from '../utils/actors';
import {
  addMember,
  createBackupCode,
  createDeviceSession,
  createInvitation,
  createOtp,
  createPasswordResetToken,
  seedTenantWithUser,
} from '../factories';
import { AuthGrpcController } from '../../src/modules/auth/auth-grpc.controller';
import { BillingGrpcController } from '../../src/modules/billing/billing-grpc.controller';
import { DepartmentsGrpcController } from '../../src/modules/departments/departments-grpc.controller';
import { InvitationsGrpcController } from '../../src/modules/invitations/invitations-grpc.controller';
import { OrganizationsGrpcController } from '../../src/modules/organizations/organizations-grpc.controller';
import { OtpGrpcController } from '../../src/modules/otp/otp-grpc.controller';
import { PlatformGrpcController } from '../../src/modules/platform/platform-grpc.controller';
import { RolesGrpcController } from '../../src/modules/roles/roles-grpc.controller';
import { SessionsGrpcController } from '../../src/modules/sessions/sessions-grpc.controller';
import { TwoFactorAuthGrpcController } from '../../src/modules/auth/two-factor-auth-grpc.controller';
import { UsersGrpcController } from '../../src/modules/users/users-grpc.controller';
import { superAdminContext } from '@synapsedesk/testing/context';
import { expectRpc } from '@synapsedesk/testing/rpc';
import { systemContext } from '@synapsedesk/contracts';
import { status } from '@grpc/grpc-js';

/**
 * **The cross-tenant probe**: every RPC that takes an id, called by tenant
 * B's most privileged member on tenant A's ids, answers as it does for an id
 * that doesn't exist, names nothing of A's, and leaves A's rows as they were.
 *
 * The RPC list comes from the proto files (`idTakingMethods`), and the first
 * row holds this table to it: a new id-taking RPC fails here until it says
 * how to call it.
 */
describe('Cross-tenant probe: auth-service (e2e)', () => {
  let fx: E2eFixture;
  let controllers: Record<string, object>;
  let B: Awaited<ReturnType<typeof seedTenantWithUser>>;

  type A = Awaited<ReturnType<typeof seedA>>;

  /** Tenant A with one of everything this service stores. */
  async function seedA() {
    const tenant = await seedTenantWithUser(fx.prisma, {
      permissionCodes: ['user.read'],
    });
    const member = await addMember(fx.prisma, tenant.org.id);
    const { row: invitation } = await createInvitation(
      fx.prisma,
      tenant.org.id,
      {
        invitedById: tenant.user.id,
      },
    );
    const { session } = await createDeviceSession(fx.prisma, member.id);
    await createBackupCode(fx.prisma, member.id);
    await createOtp(fx.prisma, member.id);
    await createPasswordResetToken(fx.prisma, member.id);

    return {
      organizationId: tenant.org.id,
      admin: tenant.user.id,
      member: member.id,
      department: tenant.department.id,
      role: tenant.role.id,
      invitation: invitation.id,
      session: session.id,
    };
  }

  type Row =
    | {
        build: (a: A) => Record<string, unknown>;
        /** The finding this row holds as a known failure until the scoped client closes it. */
        knownFailure?: string;
      }
    | { exempt: string };

  const CATALOG =
    'names the plan catalog, which every tenant shares; there is no tenant row to reach';
  const BY_DESIGN =
    'reads any tenant by design, for the rollup and quota jobs; it answers only a system caller (`requireSystem`)';
  const member = (a: A) => ({ userId: a.member });
  const memberById = (a: A) => ({ id: a.member });
  const department = (a: A) => ({ id: a.department });
  const role = (a: A) => ({ id: a.role });

  /** How to call each id-taking RPC with A's ids. */
  const PROBE: Record<string, Row> = {
    'BillingService/CreateCheckoutSession': { exempt: CATALOG },
    'BillingService/PreviewPlanChange': { exempt: CATALOG },
    'BillingService/ChangePlan': { exempt: CATALOG },
    'BillingService/PreviewCheckout': { exempt: CATALOG },
    'PlatformService/CreatePlan': { exempt: CATALOG },
    'PlatformService/GetPlan': { exempt: CATALOG },
    'PlatformService/UpdatePlan': { exempt: CATALOG },
    'PlatformService/DeletePlan': { exempt: CATALOG },
    'PlatformService/ApplyPlan': { exempt: CATALOG },

    'DepartmentService/ListDepartmentsByIds': {
      build: (a) => ({ departmentIds: [a.department] }),
    },
    'DepartmentService/GetDepartment': { build: department },
    'DepartmentService/UpdateDepartment': {
      build: (a) => ({
        id: a.department,
        name: 'B was here',
        description: 'B',
      }),
    },
    'DepartmentService/DeleteDepartment': { build: department },
    'DepartmentService/RestoreDepartment': { build: department },
    'DepartmentService/ListDepartmentMembers': {
      build: (a) => ({ departmentId: a.department, page: pageRequest() }),
    },
    'DepartmentService/AddDepartmentMembers': {
      build: (a) => ({ departmentId: a.department, userIds: [a.member] }),
    },
    'DepartmentService/RemoveDepartmentMember': {
      build: (a) => ({ departmentId: a.department, userId: a.admin }),
    },

    // Service-to-service: the tenant is the request field. B naming its own
    // tenant must not reach A's invitation.
    'InvitationService/CreateInvitations': {
      build: (a) => ({
        organizationId: B.org.id,
        invitedById: a.admin,
        invitations: [
          {
            email: `${randomUUID()}@example.test`,
            roleIds: [a.role],
            departmentIds: [a.department],
          },
        ],
      }),
    },
    'InvitationService/ResendInvitation': {
      build: (a) => ({
        organizationId: B.org.id,
        invitationId: a.invitation,
        actorId: B.user.id,
      }),
    },
    'InvitationService/RevokeInvitation': {
      build: (a) => ({
        organizationId: B.org.id,
        invitationId: a.invitation,
        actorId: B.user.id,
      }),
    },
    'InvitationService/GetInvitation': {
      build: (a) => ({ organizationId: B.org.id, invitationId: a.invitation }),
    },

    'OrganizationService/ListOrganizationTimezones': { exempt: BY_DESIGN },
    'OrganizationService/ListOrganizationCycles': { exempt: BY_DESIGN },
    'OrganizationService/ResolveTenantAuditNames': {
      build: (a) => ({
        userIds: [a.admin],
        departmentIds: [a.department],
        roleIds: [a.role],
        invitationIds: [a.invitation],
        organizationIds: [a.organizationId],
      }),
    },

    'OtpService/RequestEmailVerification': {
      build: member,
    },
    'OtpService/VerifyEmail': {
      build: (a) => ({ userId: a.member, code: '123456' }),
    },
    'OtpService/RequestPhoneVerification': {
      build: (a) => ({ userId: a.member, phoneNumber: '+84901234567' }),
    },
    'OtpService/VerifyPhone': {
      build: (a) => ({ userId: a.member, code: '123456' }),
    },
    'OtpService/GetOtpStatus': {
      build: (a) => ({ userId: a.member, purpose: 1 }),
    },

    'PlatformService/AssignPlan': {
      build: (a) => ({
        organizationId: a.organizationId,
        planId: randomUUID(),
        reason: 'B',
      }),
    },
    'PlatformService/ResolveAuditNames': {
      build: (a) => ({
        userIds: [a.admin],
        organizationIds: [a.organizationId],
      }),
    },

    'RoleService/GetRole': { build: role },
    'RoleService/UpdateRole': {
      build: (a) => ({ id: a.role, name: 'B was here', description: 'B' }),
    },
    'RoleService/DeleteRole': { build: role },
    'RoleService/SetRolePermissions': {
      build: (a) => ({ id: a.role, permissionCodes: ['user.read'] }),
    },
    'RoleService/AssignRoleUsers': {
      build: (a) => ({ roleId: a.role, userIds: [a.member] }),
    },
    'RoleService/RevokeRoleUser': {
      build: (a) => ({ roleId: a.role, userId: a.admin }),
    },

    'SessionService/RevokeSession': {
      build: (a) => ({ sessionId: a.session }),
    },
    'SessionService/RevokeSessionTrust': {
      build: (a) => ({ sessionId: a.session }),
    },
    'SessionService/ListUserSessions': { build: member },
    'SessionService/RevokeUserSessions': { build: member },

    'TwoFactorAuthService/GenerateTwoFactor': {
      build: member,
    },
    'TwoFactorAuthService/ActivateTwoFactor': {
      build: (a) => ({ userId: a.member, code: '123456', twoFactorToken: 'x' }),
    },
    'TwoFactorAuthService/DisableTwoFactor': {
      build: (a) => ({ userId: a.member, code: '123456', password: 'x' }),
    },
    'TwoFactorAuthService/RegenerateBackupCodes': {
      build: (a) => ({ userId: a.member, password: 'x' }),
    },
    'TwoFactorAuthService/GetBackupCodesStatus': {
      build: member,
    },

    'UserService/GetCurrentUser': {
      build: member,
    },
    'UserService/ListUsers': {
      build: (a) => ({
        page: pageRequest(),
        departmentId: a.department,
        roleId: a.role,
        includeDeleted: true,
      }),
    },
    'UserService/GetUser': { build: memberById },
    'UserService/GetUserPermissions': { build: memberById },
    // Both name A's tenant: the first serves system callers only, the second
    // only the caller's own tenant.
    'UserService/ListPermissionHolders': {
      build: (a) => ({
        organizationId: a.organizationId,
        permissionCode: 'user.read',
        departmentId: a.department,
      }),
    },
    'UserService/ListUsersByIds': {
      build: (a) => ({
        organizationId: a.organizationId,
        userIds: [a.admin, a.member],
        includeInactive: true,
      }),
    },
    'UserService/CreateUser': {
      build: (a) => ({
        email: `${randomUUID()}@example.test`,
        fullName: 'B’s hire',
        roleIds: [a.role],
        departmentIds: [a.department],
        primaryDepartmentId: a.department,
      }),
    },
    'UserService/UpdateUser': {
      build: (a) => ({ id: a.member, fullName: 'B was here' }),
    },
    'UserService/DeleteUser': { build: memberById },
    'UserService/RestoreUser': { build: memberById },
    'UserService/LockUser': { build: (a) => ({ id: a.member, reason: 'B' }) },
    'UserService/UnlockUser': { build: memberById },
    'UserService/ResetUserTwoFactor': { build: memberById },
    'UserService/SetUserRoles': {
      build: (a) => ({ id: a.member, roleIds: [a.role] }),
    },
    'UserService/SetUserDepartments': {
      build: (a) => ({
        id: a.member,
        departments: [{ departmentId: a.department, isPrimary: true }],
      }),
    },
  };

  const methods = idTakingMethods('auth');

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    controllers = {
      AuthService: fx.moduleRef.get(AuthGrpcController),
      BillingService: fx.moduleRef.get(BillingGrpcController),
      DepartmentService: fx.moduleRef.get(DepartmentsGrpcController),
      InvitationService: fx.moduleRef.get(InvitationsGrpcController),
      OrganizationService: fx.moduleRef.get(OrganizationsGrpcController),
      OtpService: fx.moduleRef.get(OtpGrpcController),
      PlatformService: fx.moduleRef.get(PlatformGrpcController),
      RoleService: fx.moduleRef.get(RolesGrpcController),
      SessionService: fx.moduleRef.get(SessionsGrpcController),
      TwoFactorAuthService: fx.moduleRef.get(TwoFactorAuthGrpcController),
      UserService: fx.moduleRef.get(UsersGrpcController),
    };
  });

  afterAll(async () => fx.close());

  beforeEach(async () => {
    await fx.reset();
    B = await seedTenantWithUser(fx.prisma);
  });

  /** A's world for one row: A seeded, A's identifiers, and the request on A's ids. */
  const setUp = async (name: string, method: IdTakingMethod) => {
    const a = await seedA();
    const local = tenantIdentifiers(
      await snapshot(fx.prisma),
      a.organizationId,
    );
    const row = PROBE[name] as { build: (a: A) => Record<string, unknown> };
    const foreign = new Set<string>();

    return { local, foreign, request: wireRequest(method, row.build(a)) };
  };

  it('**no row is a known failure**: every cross-tenant reach found here is closed', () => {
    expect(
      Object.keys(PROBE).filter((name) => 'knownFailure' in PROBE[name]),
    ).toEqual([]);
  });

  it('**every id-taking RPC has a row**, and no row names an RPC that is gone', () => {
    expect(Object.keys(PROBE).sort()).toEqual(
      methods.map((m) => m.name).sort(),
    );
  });

  const probe = async (name: string, method: IdTakingMethod) => {
    const { request, local, foreign } = await setUp(name, method);

    const report = await probeCall({
      request,
      call: controllerCall(controllers, name, superuser(B)),
      local,
      foreign,
      prisma: fx.prisma,
    });

    expect(report).toEqual({
      ...CLEAN,
      onA: report.onA,
      onMissing: report.onMissing,
    });
  };

  it.each(
    methods
      .filter((method) => 'build' in PROBE[method.name])
      .map((method) => [method.name, method] as const),
  )(
    '**%s** as tenant B on A’s ids: answers as for a missing id, names nothing of A’s, changes nothing of A’s',
    probe,
  );
  /**
   * **What a Super Admin gets** on each id-taking RPC, called through the
   * tenant route with no tenant, as the gateway lets a Super Admin do. The
   * scoped client refuses one (`FAILED_PRECONDITION`, "use the platform
   * API"); a row with any other outcome says why. A change to who a Super
   * Admin reaches fails a row.
   *
   * `PROBE_RECORD=<file>` writes each outcome to the file instead.
   */
  const SUPER_ADMIN: Record<string, string> = {
    'DepartmentService/AddDepartmentMembers': 'refused FAILED_PRECONDITION',
    'DepartmentService/DeleteDepartment': 'refused FAILED_PRECONDITION',
    'DepartmentService/GetDepartment': 'refused FAILED_PRECONDITION',
    'DepartmentService/ListDepartmentMembers': 'refused FAILED_PRECONDITION',
    'DepartmentService/ListDepartmentsByIds': 'refused FAILED_PRECONDITION',
    'DepartmentService/RemoveDepartmentMember': 'refused FAILED_PRECONDITION',
    'DepartmentService/RestoreDepartment': 'refused FAILED_PRECONDITION',
    'DepartmentService/UpdateDepartment': 'refused FAILED_PRECONDITION',
    'InvitationService/CreateInvitations': 'refused PERMISSION_DENIED',
    'InvitationService/GetInvitation': 'refused NOT_FOUND',
    'InvitationService/ResendInvitation': 'refused NOT_FOUND',
    'InvitationService/RevokeInvitation': 'refused NOT_FOUND',
    'OrganizationService/ResolveTenantAuditNames':
      'refused FAILED_PRECONDITION',
    'OtpService/GetOtpStatus':
      "refused NOT_FOUND: since the scoped client, `requireSelf` holds the request's user to the caller's own (was answers)",
    'OtpService/RequestEmailVerification':
      "refused NOT_FOUND: since the scoped client, `requireSelf` holds the request's user to the caller's own (was refused FAILED_PRECONDITION)",
    'OtpService/RequestPhoneVerification':
      "refused NOT_FOUND: since the scoped client, `requireSelf` holds the request's user to the caller's own (was reaches)",
    'OtpService/VerifyEmail':
      "refused NOT_FOUND: since the scoped client, `requireSelf` holds the request's user to the caller's own (was reaches)",
    'OtpService/VerifyPhone':
      "refused NOT_FOUND: since the scoped client, `requireSelf` holds the request's user to the caller's own (was refused FAILED_PRECONDITION)",
    'PlatformService/AssignPlan': 'refused NOT_FOUND',
    'PlatformService/ResolveAuditNames':
      'answers: a platform RPC; a Super Admin is who it serves',
    'RoleService/AssignRoleUsers': 'refused FAILED_PRECONDITION',
    'RoleService/DeleteRole': 'refused FAILED_PRECONDITION',
    'RoleService/GetRole': 'refused FAILED_PRECONDITION',
    'RoleService/RevokeRoleUser': 'refused FAILED_PRECONDITION',
    'RoleService/SetRolePermissions': 'refused FAILED_PRECONDITION',
    'RoleService/UpdateRole': 'refused FAILED_PRECONDITION',
    'SessionService/ListUserSessions': 'refused FAILED_PRECONDITION',
    'SessionService/RevokeSession': 'refused NOT_FOUND',
    'SessionService/RevokeSessionTrust': 'refused NOT_FOUND',
    'SessionService/RevokeUserSessions': 'refused FAILED_PRECONDITION',
    'TwoFactorAuthService/ActivateTwoFactor':
      "refused NOT_FOUND: since the scoped client, `requireSelf` holds the request's user to the caller's own (was refused UNAUTHENTICATED)",
    'TwoFactorAuthService/DisableTwoFactor':
      "refused NOT_FOUND: since the scoped client, `requireSelf` holds the request's user to the caller's own (was refused FAILED_PRECONDITION)",
    'TwoFactorAuthService/GenerateTwoFactor':
      "refused NOT_FOUND: since the scoped client, `requireSelf` holds the request's user to the caller's own (was reaches)",
    'TwoFactorAuthService/GetBackupCodesStatus':
      "refused NOT_FOUND: since the scoped client, `requireSelf` holds the request's user to the caller's own (was answers)",
    'TwoFactorAuthService/RegenerateBackupCodes':
      "refused NOT_FOUND: since the scoped client, `requireSelf` holds the request's user to the caller's own (was refused FAILED_PRECONDITION)",
    'UserService/CreateUser': 'refused FAILED_PRECONDITION',
    'UserService/DeleteUser': 'refused FAILED_PRECONDITION',
    'UserService/GetCurrentUser':
      "refused NOT_FOUND: since the scoped client, `requireSelf` holds the request's user to the caller's own (was reaches)",
    'UserService/GetUser': 'refused FAILED_PRECONDITION',
    'UserService/GetUserPermissions': 'refused FAILED_PRECONDITION',
    'UserService/ListPermissionHolders': 'refused PERMISSION_DENIED',
    'UserService/ListUsers': 'refused FAILED_PRECONDITION',
    'UserService/ListUsersByIds': 'refused FAILED_PRECONDITION',
    'UserService/LockUser': 'refused FAILED_PRECONDITION',
    'UserService/ResetUserTwoFactor': 'refused FAILED_PRECONDITION',
    'UserService/RestoreUser': 'refused FAILED_PRECONDITION',
    'UserService/SetUserDepartments': 'refused FAILED_PRECONDITION',
    'UserService/SetUserRoles': 'refused FAILED_PRECONDITION',
    'UserService/UnlockUser': 'refused FAILED_PRECONDITION',
    'UserService/UpdateUser': 'refused FAILED_PRECONDITION',
  };
  /** The seeded Super Admin, a real account as on the platform. */
  let superAdminId: string;
  beforeEach(async () => {
    superAdminId = (
      await fx.prisma.user.findFirstOrThrow({ where: { isSuperAdmin: true } })
    ).id;
  });
  const asSuperAdmin = () => superAdminContext(superAdminId);

  it('**every id-taking RPC has a Super Admin expectation**', () => {
    if (process.env.PROBE_RECORD) return;
    expect(Object.keys(SUPER_ADMIN).sort()).toEqual(
      methods
        .filter((method) => 'build' in PROBE[method.name])
        .map((method) => method.name)
        .sort(),
    );
  });

  it.each(
    methods
      .filter((method) => 'build' in PROBE[method.name])
      .map(
        (method) =>
          [
            method.name,
            SUPER_ADMIN[method.name] ?? 'unrecorded',
            method,
          ] as const,
      ),
  )(
    '**%s** as a Super Admin on A’s ids: %s',
    async (name, expected, method) => {
      const { request, local, foreign } = await setUp(name, method);

      const reached = await superAdminReach({
        request,
        call: controllerCall(controllers, name, asSuperAdmin()),
        local,
        foreign,
        prisma: fx.prisma,
      });

      if (process.env.PROBE_RECORD) {
        appendFileSync(
          process.env.PROBE_RECORD,
          `${JSON.stringify([name, reached])}\n`,
        );
        return;
      }
      expect(reached).toBe(expected.split(':')[0]);
    },
  );

  /**
   * **`ResolveInboundSender`**, which takes a tenant and no id, so the id
   * sweep above never lists it. It provisions a user in the tenant it names,
   * so only a system caller (the gateway's inbound mail) may call it.
   */
  describe('ResolveInboundSender: system callers only', () => {
    // Through a promise, so a refusal the handler throws synchronously still
    // rejects.
    const resolve =
      (context: Parameters<typeof controllerCall>[2]) =>
      (request: Record<string, unknown>) =>
        Promise.resolve().then(() =>
          controllerCall(
            controllers,
            'UserService/ResolveInboundSender',
            context,
          )(request),
        );
    const naming = (organizationId: string) => ({
      organizationId,
      email: `${randomUUID()}@example.test`,
      displayName: 'Inbound sender',
    });

    it('**tenant B naming A’s tenant** is refused, and A gains no user', async () => {
      const a = await seedA();
      const before = await fx.prisma.user.count({
        where: { organizationId: a.organizationId },
      });

      await expectRpc(
        resolve(superuser(B))(naming(a.organizationId)),
        status.PERMISSION_DENIED,
      );

      expect(
        await fx.prisma.user.count({
          where: { organizationId: a.organizationId },
        }),
      ).toBe(before);
    });

    it('**a Super Admin** is refused', async () => {
      const a = await seedA();

      await expectRpc(
        resolve(asSuperAdmin())(naming(a.organizationId)),
        status.PERMISSION_DENIED,
      );
    });

    it('**a system caller for the tenant** is answered', async () => {
      const a = await seedA();

      await expect(
        resolve(systemContext(a.organizationId))(naming(a.organizationId)),
      ).resolves.toBeDefined();
    });
  });
});
