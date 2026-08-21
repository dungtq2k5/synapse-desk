/**
 * WIRE-shaped fixtures — what auth-service would actually put on the gRPC
 * connection, not what the REST response looks like.
 *
 * These exist because the gateway's mappers are strict on purpose:
 * `requireProtoTimestamp` throws on a missing `createdAt` rather than substituting a
 * date, so a hand-written stub like `{ id, email, fullName }` produces a 500
 * instead of the 200 the test expects — and the failure points at the mapper,
 * not at the fixture that caused it. Building the shapes once, correctly, is
 * what keeps every e2e assertion about the route rather than about the stub.
 */

import { faker } from '@faker-js/faker';
import {
  AssignmentResponse,
  AttachmentResponse,
  CreateMessageResponse,
  MessageResponse,
  ReassignmentReason as ProtoReassignmentReason,
  Gender as ProtoGender,
  TicketPriority as ProtoTicketPriority,
  TicketResponse,
  TicketSource as ProtoTicketSource,
  TicketStatus as ProtoTicketStatus,
  PageMeta,
  ProtoTimestamp,
  UserResponse,
  UserSummary,
  UserSummaryResponse,
  MessageAnswerStatus,
} from '@synapsedesk/grpc-proto';

/** protobuf's Timestamp: seconds + nanos, never a JS Date. */
export function timestamp(date: Date = new Date()): ProtoTimestamp {
  return {
    seconds: Math.floor(date.getTime() / 1000),
    nanos: (date.getTime() % 1000) * 1_000_000,
  };
}

export function wireUser(overrides: Partial<UserResponse> = {}): UserResponse {
  return {
    id: faker.string.uuid(),
    organizationId: faker.string.uuid(),
    fullName: faker.person.fullName(),
    avatarUrl: undefined,
    email: faker.internet.email().toLowerCase(),
    isEmailVerified: true,
    phoneNumber: undefined,
    isPhoneVerified: false,
    dob: undefined,
    // The proto's zero value. It maps to `null` at the REST edge, which is the
    // documented "not stated" — deliberately not MALE-by-accident.
    gender: ProtoGender.GENDER_UNSPECIFIED,
    lastLoginAt: undefined,
    isLocked: false,
    isTwoFactorEnabled: false,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    ...overrides,
  };
}

export function wireUserSummary(
  overrides: Partial<UserSummaryResponse> = {},
): UserSummaryResponse {
  return {
    user: wireUser(),
    roleIds: [],
    roleNames: [],
    departmentIds: [],
    deletedAt: undefined,
    deletedByName: undefined,
    ...overrides,
  };
}

/**
 * The NARROW projection `ListUsersByIds` puts in `summaries` — not the envelope
 * {@link wireUserSummary} builds.
 *
 * The two are one letter apart in the proto and completely different on the
 * wire: `UserSummaryResponse` wraps a whole user beside its roles, while
 * `UserSummary` is the five fields an EDGE is allowed to see. This
 * one is what the loaders batch, so it is what every field-resolver test needs.
 *
 * Here rather than redeclared per describe-block: two `graphql.e2e-spec.ts`
 * blocks had byte-identical private copies, which is one definition of the wire
 * more than there can be — and the copy that drifts is whichever the next reader
 * does not open.
 */
export function wireUserProjection(
  overrides: Partial<UserSummary> = {},
): UserSummary {
  return {
    userId: faker.string.uuid(),
    fullName: faker.person.fullName(),
    avatarUrl: undefined,
    isLocked: false,
    deletedAt: undefined,
    ...overrides,
  };
}

export function wirePageMeta(overrides: Partial<PageMeta> = {}): PageMeta {
  return {
    totalItems: 0,
    itemCount: 0,
    itemsPerPage: 20,
    totalPages: 0,
    currentPage: 1,
    ...overrides,
  };
}

/**
 * A list response whose meta actually matches the items it carries.
 *
 * Derived rather than hand-passed because a stub claiming `totalItems: 0`
 * alongside three items produces a page the gateway will happily forward — and
 * a pagination assertion that passes against nonsense.
 */
export function wirePage<T>(items: T[], overrides: Partial<PageMeta> = {}) {
  const itemsPerPage = overrides.itemsPerPage ?? 20;
  const totalItems = overrides.totalItems ?? items.length;

  return {
    items,
    meta: wirePageMeta({
      totalItems,
      itemCount: items.length,
      itemsPerPage,
      totalPages: Math.ceil(totalItems / itemsPerPage),
      currentPage: 1,
      ...overrides,
    }),
  };
}

/** A fully successful login — no tenant selection, no 2FA challenge. */
export function wireLoginSuccess(user: UserResponse = wireUser()) {
  return {
    requiresTenantSelection: false,
    requiresTwoFactor: false,
    requiresTwoFactorSetup: false,
    accessToken: 'access-token-fixture',
    refreshToken: 'refresh-token-fixture',
    tenants: [],
    user,
  };
}

/** One address, several tenants: the client must choose before anything else. */
export function wireLoginTenantSelection(
  tenants = [
    {
      organizationId: faker.string.uuid(),
      name: 'Tenant A',
      slug: 'tenant-a',
    },
    {
      organizationId: faker.string.uuid(),
      name: 'Tenant B',
      slug: 'tenant-b',
    },
  ],
) {
  return {
    requiresTenantSelection: true,
    requiresTwoFactor: false,
    requiresTwoFactorSetup: false,
    tenantSelectionToken: 'tenant-selection-token-fixture',
    tenants,
    user: undefined,
  };
}

/** Password accepted, second factor outstanding. */
export function wireLoginTwoFactor(requiresTwoFactorSetup = false) {
  return {
    requiresTenantSelection: false,
    requiresTwoFactor: true,
    requiresTwoFactorSetup,
    twoFactorToken: 'two-factor-token-fixture',
    tenants: [],
    user: undefined,
  };
}

/**
 * An error as it arrives FROM gRPC — a plain object with `code` and `details`,
 * not an `RpcException`.
 *
 * The distinction matters at the gateway: `AllHttpExceptionFilter` maps by
 * reading `.code` off the error, and an `RpcException` (which is what
 * auth-service THROWS, on the other side of the wire) does not have one at the
 * top level. Stubbing with the wrong one turns every expected 401/404/409 into
 * a 500, and the test then documents the filter failing rather than the route
 * working.
 */
export function grpcError(code: number, details: string) {
  return Object.assign(new Error(details), { code, details });
}

/**
 * A ticket as ticket-service puts it on the wire.
 *
 * Enum fields carry their NUMERIC proto values, not the domain strings: that is
 * what actually travels, and a fixture using `'OPEN'` would make the gateway's
 * enum mapper look correct while it silently produced null for every row.
 */
export function wireTicket(
  overrides: Partial<TicketResponse> = {},
): TicketResponse {
  return {
    id: faker.string.uuid(),
    ticketNumber: faker.number.int({ min: 1, max: 9999 }),
    organizationId: faker.string.uuid(),
    authorId: faker.string.uuid(),
    source: ProtoTicketSource.TICKET_SOURCE_WEB,
    status: ProtoTicketStatus.TICKET_STATUS_OPEN,
    priority: ProtoTicketPriority.TICKET_PRIORITY_MEDIUM,
    title: faker.hacker.phrase(),
    description: faker.lorem.paragraph(),
    currentAssigneeId: undefined,
    currentDepartmentId: undefined,
    escalatedAt: undefined,
    resolvedAt: undefined,
    unreadCount: 0,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    deletedAt: undefined,
    deletedById: undefined,
    ...overrides,
  };
}

/**
 * An assignment entry as ticket-service puts it on the wire.
 *
 * `isCurrent: true` and a `undefined` `unassignedAt` together — the live entry.
 * A fixture that set one without the other would describe a row the service
 * cannot produce, and a mapper test built on it would prove nothing.
 */
export function wireAssignment(
  overrides: Partial<AssignmentResponse> = {},
): AssignmentResponse {
  return {
    id: faker.string.uuid(),
    ticketId: faker.string.uuid(),
    assignedToId: faker.string.uuid(),
    assignedById: faker.string.uuid(),
    departmentId: faker.string.uuid(),
    assignedAt: timestamp(),
    unassignedAt: undefined,
    reason: ProtoReassignmentReason.REASSIGNMENT_REASON_INITIAL,
    isCurrent: true,
    createdAt: timestamp(),
    ...overrides,
  };
}

/** A message as ticket-service puts it on the wire. */
export function wireMessage(
  overrides: Partial<MessageResponse> = {},
): MessageResponse {
  return {
    id: faker.string.uuid(),
    ticketId: faker.string.uuid(),
    senderId: faker.string.uuid(),
    content: faker.lorem.sentences(2),
    isAiGenerated: false,
    isInternalNote: false,
    modelName: undefined,
    promptTokens: undefined,
    completionTokens: undefined,
    editedAt: undefined,
    redactedAt: undefined,
    createdAt: timestamp(),
    attachments: [],
    excludedFromAiContext: false,
    answerStatus: MessageAnswerStatus.MESSAGE_ANSWER_STATUS_UNSPECIFIED,
    ...overrides,
  };
}

/**
 * What `CreateMessage` puts on the wire.
 *
 * A wrapper because a create has a second outcome: an attachment whose confirm
 * failed is named and the message is written anyway. `skippedAttachments`
 * defaults to empty, which is the ordinary case and keeps every test that
 * predates the field reading as it did.
 */
export function wireCreatedMessage(
  overrides: Partial<MessageResponse> = {},
  skippedAttachments: string[] = [],
): CreateMessageResponse {
  return { message: wireMessage(overrides), skippedAttachments };
}

export function wireAttachment(
  overrides: Partial<AttachmentResponse> = {},
): AttachmentResponse {
  return {
    id: faker.string.uuid(),
    messageId: faker.string.uuid(),
    fileName: 'screenshot.png',
    // An object PATH, not a URL — what the column actually holds.
    fileUrl: 'organizations/org/tickets/t/attachments/m/abc.png',
    fileSizeBytes: 2048,
    mimeType: 'image/png',
    createdAt: timestamp(),
    ...overrides,
  };
}
