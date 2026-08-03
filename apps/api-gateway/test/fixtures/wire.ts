import { faker } from '@faker-js/faker';
import {
  Gender as ProtoGender,
  PageMeta,
  ProtoTimestamp,
  UserResponse,
  UserSummaryResponse,
} from '@synapsedesk/grpc-proto';

/**
 * WIRE-shaped fixtures — what auth-service would actually put on the gRPC
 * connection, not what the REST response looks like.
 *
 * These exist because the gateway's mappers are strict on purpose:
 * `requireTimestamp` throws on a missing `createdAt` rather than substituting a
 * date, so a hand-written stub like `{ id, email, fullName }` produces a 500
 * instead of the 200 the test expects — and the failure points at the mapper,
 * not at the fixture that caused it. Building the shapes once, correctly, is
 * what keeps every e2e assertion about the route rather than about the stub.
 */

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
