import {
  DEFAULT_SEARCH,
  Gender,
  InvitationStatus,
  OtpPurpose,
  type SortOrder,
} from '@synapsedesk/common';
import {
  Gender as ProtoGender,
  PageMeta,
  PageRequest,
  SortOrder as ProtoSortOrder,
} from './generated/synapsedesk/auth/common';
import { InvitationStatus as ProtoInvitationStatus } from './generated/synapsedesk/auth/invitation';
import { OtpPurpose as ProtoOtpPurpose } from './generated/synapsedesk/auth/otp';

/**
 * Conversions every service needs when a Prisma row meets the wire, kept here
 * rather than copied into each service's mapper.
 *
 * They are all consequences of `GRPC_LOADER_OPTIONS`, so they belong next to
 * it: `longs: Number` makes Timestamp seconds a plain number, and
 * `enums: Number` makes proto enums numeric while the shared domain enums are
 * strings.
 */

/** The runtime shape of `google.protobuf.Timestamp` under @grpc/proto-loader. */
export type ProtoTimestamp = { seconds: number; nanos: number };

/**
 * `google.protobuf.Timestamp` is NOT a `Date` on the wire. proto-loader treats
 * it as an ordinary message, so it travels as `{ seconds, nanos }`.
 */
export function toTimestamp(date: Date | null): ProtoTimestamp | undefined {
  if (!date) return undefined;

  const ms = date.getTime();
  return {
    seconds: Math.floor(ms / 1000),
    nanos: (ms % 1000) * 1_000_000,
  };
}

export function fromTimestamp(
  timestamp: ProtoTimestamp | undefined,
): Date | undefined {
  if (!timestamp) return undefined;

  return new Date(timestamp.seconds * 1000 + Math.floor(timestamp.nanos / 1e6));
}

/**
 * For proto fields that are non-optional. ts-proto types every message-valued
 * field as `T | undefined` — that is its convention for message fields, not
 * permission to omit them — so a missing value is a contract violation and
 * should say so rather than be papered over with a fallback date.
 */
export function requireTimestamp(
  timestamp: ProtoTimestamp | undefined,
  field: string,
): Date {
  const date = fromTimestamp(timestamp);
  if (!date) {
    throw new Error(`Received a message without the required ${field}`);
  }

  return date;
}

/**
 * Two different types share the name `Gender` and they are NOT interchangeable:
 * the shared domain enum is a string ('MALE'), the proto one is numeric (1).
 * These two functions are the only sanctioned bridge.
 */
const PROTO_GENDER_BY_NAME: Record<Gender, ProtoGender> = {
  [Gender.UNSPECIFIED]: ProtoGender.GENDER_UNSPECIFIED,
  [Gender.MALE]: ProtoGender.GENDER_MALE,
  [Gender.FEMALE]: ProtoGender.GENDER_FEMALE,
  [Gender.OTHER]: ProtoGender.GENDER_OTHER,
};

const GENDER_NAME_BY_PROTO: Record<number, Gender> = {
  [ProtoGender.GENDER_UNSPECIFIED]: Gender.UNSPECIFIED,
  [ProtoGender.GENDER_MALE]: Gender.MALE,
  [ProtoGender.GENDER_FEMALE]: Gender.FEMALE,
  [ProtoGender.GENDER_OTHER]: Gender.OTHER,
};

/** The column is a nullable VarChar; the proto field is non-optional, so null
 * maps onto UNSPECIFIED — which is what proto3's mandatory zero value is for. */
export function toProtoGender(gender: string | null): ProtoGender {
  if (!gender) return ProtoGender.GENDER_UNSPECIFIED;

  return (
    PROTO_GENDER_BY_NAME[gender as Gender] ?? ProtoGender.GENDER_UNSPECIFIED
  );
}

export function fromProtoGender(gender: ProtoGender): Gender {
  // UNRECOGNIZED (-1) lands here too: a value this build does not know about is
  // closer to "unspecified" than to a crash.
  return GENDER_NAME_BY_PROTO[gender] ?? Gender.UNSPECIFIED;
}

/**
 * `@db.Date` columns are calendar dates — no time, no zone. Formatted from UTC
 * components so the day cannot drift for a server west of UTC.
 */
export function toIsoDate(date: Date | null): string | undefined {
  if (!date) return undefined;

  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');

  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Bridges the proto's numeric `OtpPurpose` to the domain enum stored in
 * `otps.purpose` as text.
 *
 * With the purpose enumerated in the contract there is nothing left to validate:
 * protoc will not let a caller send a value outside the enum, so the only case
 * to handle is UNSPECIFIED — the proto3 zero value, which here means "the field
 * was omitted" and must be rejected rather than defaulting to a real purpose.
 * Returns null for that, leaving the "how do I complain?" decision (RpcException
 * vs HTTP 400) to the caller, which knows its own transport.
 */
const DOMAIN_OTP_PURPOSE_BY_PROTO: Record<number, OtpPurpose> = {
  [ProtoOtpPurpose.OTP_PURPOSE_EMAIL_VERIFICATION]:
    OtpPurpose.EMAIL_VERIFICATION,
  [ProtoOtpPurpose.OTP_PURPOSE_PHONE_VERIFICATION]:
    OtpPurpose.PHONE_VERIFICATION,
};

const PROTO_OTP_PURPOSE_BY_DOMAIN: Record<OtpPurpose, ProtoOtpPurpose> = {
  [OtpPurpose.EMAIL_VERIFICATION]:
    ProtoOtpPurpose.OTP_PURPOSE_EMAIL_VERIFICATION,
  [OtpPurpose.PHONE_VERIFICATION]:
    ProtoOtpPurpose.OTP_PURPOSE_PHONE_VERIFICATION,
};

export function fromProtoOtpPurpose(
  purpose: ProtoOtpPurpose,
): OtpPurpose | null {
  // UNRECOGNIZED (-1) lands here too — a member added by a newer build than
  // this one, which is equally "not something we can act on".
  return DOMAIN_OTP_PURPOSE_BY_PROTO[purpose] ?? null;
}

export function toProtoOtpPurpose(purpose: OtpPurpose): ProtoOtpPurpose {
  return PROTO_OTP_PURPOSE_BY_DOMAIN[purpose];
}

/**
 * Bridges the proto's numeric `InvitationStatus` to the domain enum stored as
 * text in `user_invitations.status`.
 *
 * Same shape as the OtpPurpose bridge: UNSPECIFIED means "the caller omitted
 * the field" and maps to null, so a filter that was never set cannot silently
 * become a filter for PENDING.
 */
const DOMAIN_INVITATION_STATUS_BY_PROTO: Record<number, InvitationStatus> = {
  [ProtoInvitationStatus.INVITATION_STATUS_PENDING]: InvitationStatus.PENDING,
  [ProtoInvitationStatus.INVITATION_STATUS_ACCEPTED]: InvitationStatus.ACCEPTED,
  [ProtoInvitationStatus.INVITATION_STATUS_REVOKED]: InvitationStatus.REVOKED,
  [ProtoInvitationStatus.INVITATION_STATUS_EXPIRED]: InvitationStatus.EXPIRED,
};

const PROTO_INVITATION_STATUS_BY_DOMAIN: Record<
  InvitationStatus,
  ProtoInvitationStatus
> = {
  [InvitationStatus.PENDING]: ProtoInvitationStatus.INVITATION_STATUS_PENDING,
  [InvitationStatus.ACCEPTED]: ProtoInvitationStatus.INVITATION_STATUS_ACCEPTED,
  [InvitationStatus.REVOKED]: ProtoInvitationStatus.INVITATION_STATUS_REVOKED,
  [InvitationStatus.EXPIRED]: ProtoInvitationStatus.INVITATION_STATUS_EXPIRED,
};

export function fromProtoInvitationStatus(
  status: ProtoInvitationStatus,
): InvitationStatus | null {
  return DOMAIN_INVITATION_STATUS_BY_PROTO[status] ?? null;
}

export function toProtoInvitationStatus(
  status: InvitationStatus,
): ProtoInvitationStatus {
  return PROTO_INVITATION_STATUS_BY_DOMAIN[status];
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/**
 * The subset of the gateway's `SearchPaginationBase` that crosses the wire.
 *
 * Declared structurally rather than importing the DTO: `SearchPaginationBase`
 * is a class decorated with class-validator, which lives at the REST edge and
 * has no business being pulled into a proto library that auth-service also
 * imports. Every list query DTO extends that base, so it satisfies this shape
 * by construction.
 */
export type PageQuery = {
  page: number;
  limit: number;
  searchTerm?: string;
  sortBy: string;
  sortOrder: SortOrder;
};

/**
 * REST query DTO -> wire.
 *
 * `searchTerm` collapses to '' rather than staying undefined: proto3 scalars
 * have no null, and `defaults: true` in GRPC_LOADER_OPTIONS would materialise
 * an omitted field as '' on the receiving side anyway. Doing it here makes the
 * two ends agree explicitly instead of by accident.
 */
export function toPageRequest(query: PageQuery): PageRequest {
  return {
    page: query.page,
    limit: query.limit,
    searchTerm: query.searchTerm ?? '',
    sortBy: query.sortBy,
    sortOrder: toProtoSortOrder(query.sortOrder),
  };
}

/**
 * Builds the response envelope from what the query actually returned.
 *
 * `itemCount` is the length of THIS page and `totalItems` the size of the whole
 * result set — they differ on the last page, and conflating them is what makes
 * a paginator show the wrong number of pages.
 */
export function toPageMeta(
  page: PageRequest,
  totalItems: number,
  itemCount: number,
): PageMeta {
  const limit = clampLimit(page.limit);

  return {
    totalItems,
    itemCount,
    itemsPerPage: limit,
    totalPages: Math.ceil(totalItems / limit),
    currentPage: normalizePage(page.page),
  };
}

/**
 * Clamps a requested page size into [MIN_LIMIT, MAX_LIMIT].
 *
 * Exported because auth-service must apply it too. The gateway DTO already
 * validates the range, but a service is reachable from other services over
 * gRPC where no ValidationPipe ever ran — an unclamped `take` there is an
 * unbounded query, which is a denial of service with extra steps.
 *
 * A zero limit (proto3's default for an omitted int32) reads as "the caller did
 * not set one", so it takes the default rather than returning an empty page
 * forever.
 */
export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_SEARCH.LIMIT;

  return Math.min(
    Math.max(limit, DEFAULT_SEARCH.MIN_LIMIT),
    DEFAULT_SEARCH.MAX_LIMIT,
  );
}

/** Same reasoning as clampLimit: 0 means "unset", and page numbers are 1-based. */
export function normalizePage(page: number): number {
  if (!Number.isFinite(page) || page < 1) return DEFAULT_SEARCH.PAGE;

  return Math.floor(page);
}

/**
 * Two types share the name `SortOrder` and they are NOT interchangeable: the
 * shared domain one is a string ('ASC'), the proto one is numeric (1). These
 * two functions are the only sanctioned bridge — same arrangement as Gender
 * and OtpPurpose.
 */
const PROTO_SORT_ORDER_BY_DOMAIN: Record<SortOrder, ProtoSortOrder> = {
  ASC: ProtoSortOrder.SORT_ORDER_ASC,
  DESC: ProtoSortOrder.SORT_ORDER_DESC,
};

export function toProtoSortOrder(sortOrder: SortOrder): ProtoSortOrder {
  return (
    PROTO_SORT_ORDER_BY_DOMAIN[sortOrder] ?? ProtoSortOrder.SORT_ORDER_DESC
  );
}

/**
 * UNSPECIFIED means the caller omitted the field, which takes the default
 * rather than being rejected — direction is a presentation preference, not
 * something a request is wrong without. UNRECOGNIZED (-1), a member added by a
 * newer build than this one, lands in the same place.
 */
export function fromProtoSortOrder(sortOrder: ProtoSortOrder): SortOrder {
  if (sortOrder === ProtoSortOrder.SORT_ORDER_ASC) return 'ASC';
  if (sortOrder === ProtoSortOrder.SORT_ORDER_DESC) return 'DESC';

  return DEFAULT_SEARCH.SORT_ORDER;
}
