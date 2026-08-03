import { mock, MockProxy } from 'jest-mock-extended';
import { ClientGrpc } from '@nestjs/microservices';
import {
  AUTH_SERVICE_NAME,
  AuthServiceClient,
  DEPARTMENT_SERVICE_NAME,
  DepartmentServiceClient,
  INVITATION_SERVICE_NAME,
  InvitationServiceClient,
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
  OTP_SERVICE_NAME,
  OtpServiceClient,
  PLATFORM_SERVICE_NAME,
  PlatformServiceClient,
  ROLE_SERVICE_NAME,
  RoleServiceClient,
  SESSION_SERVICE_NAME,
  SessionServiceClient,
  TWO_FACTOR_AUTH_SERVICE_NAME,
  TwoFactorAuthServiceClient,
  USER_SERVICE_NAME,
  UserServiceClient,
} from '@synapsedesk/grpc-proto';

/**
 * Every proto service the gateway consumes, mocked.
 *
 * Auto-mocked via `mock<T>()` rather than hand-listed method by method: there
 * are ten services and roughly sixty RPCs between them, and a hand-written
 * literal is a second place to update every time an RPC is added — one that
 * fails at runtime with `undefined is not a function`, several layers below the
 * test that actually broke.
 */
export type GrpcStubs = {
  auth: MockProxy<AuthServiceClient>;
  twoFactor: MockProxy<TwoFactorAuthServiceClient>;
  otp: MockProxy<OtpServiceClient>;
  invitation: MockProxy<InvitationServiceClient>;
  session: MockProxy<SessionServiceClient>;
  organization: MockProxy<OrganizationServiceClient>;
  department: MockProxy<DepartmentServiceClient>;
  user: MockProxy<UserServiceClient>;
  role: MockProxy<RoleServiceClient>;
  platform: MockProxy<PlatformServiceClient>;
};

export type GrpcStubFixture = {
  stubs: GrpcStubs;
  /** Drop-in for the `AUTH_GRPC_CLIENT` provider. */
  clientGrpc: ClientGrpc;
};

/**
 * Builds the ten mocks and the `ClientGrpc` that hands them out.
 *
 * Keyed by the GENERATED `*_SERVICE_NAME` constants rather than by string
 * literals, so a service renamed in the proto breaks compilation here instead
 * of silently returning `undefined` from `getService()` — which surfaces at
 * boot as a crash inside somebody else's `onModuleInit`.
 */
export function stubGrpcServices(): GrpcStubFixture {
  const stubs: GrpcStubs = {
    auth: mock<AuthServiceClient>(),
    twoFactor: mock<TwoFactorAuthServiceClient>(),
    otp: mock<OtpServiceClient>(),
    invitation: mock<InvitationServiceClient>(),
    session: mock<SessionServiceClient>(),
    organization: mock<OrganizationServiceClient>(),
    department: mock<DepartmentServiceClient>(),
    user: mock<UserServiceClient>(),
    role: mock<RoleServiceClient>(),
    platform: mock<PlatformServiceClient>(),
  };

  const byServiceName: Record<string, unknown> = {
    [AUTH_SERVICE_NAME]: stubs.auth,
    [TWO_FACTOR_AUTH_SERVICE_NAME]: stubs.twoFactor,
    [OTP_SERVICE_NAME]: stubs.otp,
    [INVITATION_SERVICE_NAME]: stubs.invitation,
    [SESSION_SERVICE_NAME]: stubs.session,
    [ORGANIZATION_SERVICE_NAME]: stubs.organization,
    [DEPARTMENT_SERVICE_NAME]: stubs.department,
    [USER_SERVICE_NAME]: stubs.user,
    [ROLE_SERVICE_NAME]: stubs.role,
    [PLATFORM_SERVICE_NAME]: stubs.platform,
  };

  const clientGrpc: ClientGrpc = {
    getService: <T extends object>(name: string): T => {
      const service = byServiceName[name];
      if (!service) {
        // Loud on purpose. The real ClientGrpc returns undefined for an unknown
        // name and the failure surfaces much later as a null-property read in
        // whichever client happened to call it first.
        throw new Error(
          `No gRPC stub registered for service '${name}'. Add it to stubGrpcServices().`,
        );
      }
      return service as T;
    },
    getClientByServiceName: <T = unknown>(name: string): T =>
      byServiceName[name] as T,
  };

  return { stubs, clientGrpc };
}
