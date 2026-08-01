import { Gender, InvitationStatus, OtpPurpose } from '@synapsedesk/common';
import { Gender as ProtoGender } from './generated/synapsedesk/auth/common';
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
