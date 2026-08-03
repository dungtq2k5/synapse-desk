import {
  toIsoDate,
  toProtoGender,
  toTimestamp,
  UserResponse,
  UserSummaryResponse,
} from '@synapsedesk/grpc-proto';
import type { Prisma, User } from '../../generated/prisma/client';

/**
 * The Prisma row -> wire boundary for `User`.
 *
 * Three conventions meet here and none of them agree, so every conversion is
 * made explicitly rather than by spreading the row:
 *
 *   | layer            | "absent" is | why                                    |
 *   |------------------|-------------|----------------------------------------|
 *   | Postgres/Prisma  | null        | SQL NULL                               |
 *   | protobuf3        | undefined   | proto has no concept of null           |
 *   | REST JSON DTO    | null        | JSON has null; a missing key means     |
 *   |                  |             | "unchanged" under PATCH semantics      |
 *
 * The reverse conversion (undefined -> null, Timestamp -> Date) belongs in the
 * gateway's gRPC client, the only place allowed to import this proto package.
 */

/**
 * `UserResponse` is an ALLOW-LIST, and that is the entire point of writing this
 * out field by field.
 *
 * The obvious shortcut -- `const { passwordHash, ...rest } = user` -- is a
 * deny-list, and deny-lists fail silently and permanently: it would still ship
 * `twoFactorSecret`, `deletedAt`, `deletedById` and `isSuperAdmin` today, and
 * every sensitive column added to the schema from now on would leak the moment
 * it was added, with no test to catch it. Listing fields explicitly means a new
 * proto field is a compile error instead.
 */
export function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    // null for platform Super Admins, who belong to no tenant (RDM).
    organizationId: user.organizationId ?? undefined,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl ?? undefined,
    email: user.email,
    isEmailVerified: user.isEmailVerified,
    phoneNumber: user.phoneNumber ?? undefined,
    isPhoneVerified: user.isPhoneVerified,
    dob: toIsoDate(user.dob),
    gender: toProtoGender(user.gender),
    lastLoginAt: toTimestamp(user.lastLoginAt),
    isLocked: user.isLocked,
    isTwoFactorEnabled: user.isTwoFactorEnabled,
    // Non-optional in the proto. ts-proto types every message-valued field as
    // `T | undefined`, which is its convention for message fields -- not
    // permission to omit these.
    createdAt: toTimestamp(user.createdAt),
    updatedAt: toTimestamp(user.updatedAt),
  };
}

/**
 * The joins an admin list row needs.
 *
 * `select` on the nested relations rather than `include`, so `passwordHash` and
 * `twoFactorSecret` cannot reach the result object at all — a stronger
 * guarantee than remembering to strip them in the mapper (see the
 * conventions). The top-level user columns still come through whole because
 * `toUserResponse` is itself an allow-list.
 */
export const USER_SUMMARY_INCLUDE = {
  roles: { select: { id: true, name: true } },
  userDepartments: { select: { departmentId: true } },
  deletedBy: { select: { fullName: true } },
} satisfies Prisma.UserInclude;

export type UserSummaryRow = Prisma.UserGetPayload<{
  include: typeof USER_SUMMARY_INCLUDE;
}>;

export function toUserSummaryResponse(
  user: UserSummaryRow,
): UserSummaryResponse {
  return {
    user: toUserResponse(user),
    roleIds: user.roles.map((role) => role.id),
    roleNames: user.roles.map((role) => role.name),
    departmentIds: user.userDepartments.map((ud) => ud.departmentId),
    // Only ever set on a soft-deleted row.
    deletedAt: toTimestamp(user.deletedAt),
    deletedByName: user.deletedBy?.fullName ?? undefined,
  };
}
