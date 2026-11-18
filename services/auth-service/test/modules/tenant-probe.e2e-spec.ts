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
    'UserService/ListPermissionHolders': {
      build: (a) => ({
        organizationId: B.org.id,
        permissionCode: 'user.read',
        departmentId: a.department,
      }),
    },
    'UserService/ListUsersByIds': {
      build: (a) => ({
        organizationId: B.org.id,
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
   * **What a Super Admin reaches** on each id-taking RPC, called through the
   * tenant route with no tenant, as the gateway lets a Super Admin do. The
   * expectation is the behavior before the scoped client, recorded by running
   * these rows against `a53b7797`. A change to who a Super Admin reaches fails
   * a row; one that reaches A's data says why.
   *
   * `PROBE_RECORD=<file>` writes each outcome to the file instead.
   */
  const SUPER_ADMIN: Record<string, string> = {
    'DepartmentService/AddDepartmentMembers':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
    'DepartmentService/DeleteDepartment': 'refused ABORTED',
    'DepartmentService/GetDepartment': 'answers',
    'DepartmentService/ListDepartmentMembers':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
    'DepartmentService/ListDepartmentsByIds': 'answers',
    'DepartmentService/RemoveDepartmentMember':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
    'DepartmentService/RestoreDepartment': 'refused NOT_FOUND',
    'DepartmentService/UpdateDepartment':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
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
    'PlatformService/ResolveAuditNames': 'answers',
    'RoleService/AssignRoleUsers': 'refused FAILED_PRECONDITION',
    'RoleService/DeleteRole': 'refused FAILED_PRECONDITION',
    'RoleService/GetRole': 'refused FAILED_PRECONDITION',
    'RoleService/RevokeRoleUser': 'refused FAILED_PRECONDITION',
    'RoleService/SetRolePermissions': 'refused FAILED_PRECONDITION',
    'RoleService/UpdateRole': 'refused FAILED_PRECONDITION',
    'SessionService/ListUserSessions':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
    'SessionService/RevokeSession': 'refused NOT_FOUND',
    'SessionService/RevokeSessionTrust': 'refused NOT_FOUND',
    'SessionService/RevokeUserSessions':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
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
    'UserService/DeleteUser':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
    'UserService/GetCurrentUser':
      "refused NOT_FOUND: since the scoped client, `requireSelf` holds the request's user to the caller's own (was reaches)",
    'UserService/GetUser':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
    'UserService/GetUserPermissions': 'answers',
    'UserService/ListPermissionHolders': 'answers',
    'UserService/ListUsers':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
    'UserService/ListUsersByIds': 'answers',
    'UserService/LockUser':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
    'UserService/ResetUserTwoFactor':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
    'UserService/RestoreUser': 'refused FAILED_PRECONDITION',
    'UserService/SetUserDepartments':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
    'UserService/SetUserRoles': 'refused FAILED_PRECONDITION',
    'UserService/UnlockUser':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
    'UserService/UpdateUser':
      "reaches: a Super Admin manages any tenant's users, departments and sessions; no tenant filter for one, by design",
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
});
