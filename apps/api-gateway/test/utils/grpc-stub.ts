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
  AI_SERVICE_NAME,
  AiServiceClient,
  ASSIGNMENT_SERVICE_NAME,
  AssignmentServiceClient,
  AUDIT_SERVICE_NAME,
  AuditServiceClient,
  FEEDBACK_SERVICE_NAME,
  FeedbackServiceClient,
  MESSAGE_SERVICE_NAME,
  MessageServiceClient,
  TICKET_SERVICE_NAME,
  TicketServiceClient,
} from '@synapsedesk/grpc-proto';

/**
 * Every proto service the gateway consumes, mocked.
 *
 * Auto-mocked via `mock<T>()` rather than hand-listed method by method: there
 * are sixteen services and well over a hundred RPCs between them, and a
 * hand-written literal is a second place to update every time an RPC is added —
 * one that fails at runtime with `undefined is not a function`, several layers
 * below the test that actually broke.
 *
 * Both PEERS are covered here — auth-service's ten services and ticket-service's
 * six. They arrive at the gateway through different DI tokens
 * (`AUTH_GRPC_CLIENT`, `TICKET_GRPC_CLIENT`), and `bootstrapE2eTest` overrides
 * both with this one `ClientGrpc`: the map is keyed by SERVICE name, which is
 * unique across both packages, so one stub can serve both tokens.
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

  // Domain B. Served by a DIFFERENT peer (ticket-service) behind a different
  // DI token, but stubbed through the same map: a test asserting on a gateway
  // route should not have to know which service answers it.
  ticket: MockProxy<TicketServiceClient>;
  assignment: MockProxy<AssignmentServiceClient>;
  message: MockProxy<MessageServiceClient>;
  ai: MockProxy<AiServiceClient>;
  feedback: MockProxy<FeedbackServiceClient>;
  audit: MockProxy<AuditServiceClient>;
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

    ticket: mock<TicketServiceClient>(),
    assignment: mock<AssignmentServiceClient>(),
    message: mock<MessageServiceClient>(),
    ai: mock<AiServiceClient>(),
    feedback: mock<FeedbackServiceClient>(),
    audit: mock<AuditServiceClient>(),
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

    [TICKET_SERVICE_NAME]: stubs.ticket,
    [ASSIGNMENT_SERVICE_NAME]: stubs.assignment,
    [MESSAGE_SERVICE_NAME]: stubs.message,
    [AI_SERVICE_NAME]: stubs.ai,
    [FEEDBACK_SERVICE_NAME]: stubs.feedback,
    [AUDIT_SERVICE_NAME]: stubs.audit,
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
