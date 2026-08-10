import {
  NotificationRecipient,
  toIsoDate,
  toProtoGender,
  toProtoTimestamp,
  UserResponse,
  UserSummary,
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
/**
 * `avatarUrls` maps a stored object path -> a fresh signed read URL, as
 * produced by `UsersService.resolveAvatarUrls`.
 *
 * The column holds an internal path, and a path is not renderable and leaks the
 * storage scheme to every API consumer — so the wire value has to be the signed
 * URL. Resolution needs a gRPC call, which a mapper must not make, so the
 * caller resolves in a batch and passes the result down.
 *
 * It DEFAULTS TO `{}`, and that default is load-bearing twice over. An
 * unresolved avatar renders as absent rather than as a leaked path — failing to
 * a missing picture, never to an internal string. And it lets the platform
 * paths opt out in one word: a Super Admin has no tenant, so asking
 * storage-service would be a guaranteed FAILED_PRECONDITION.
 */
export function toUserResponse(
  user: User,
  avatarUrls: Record<string, string> = {},
): UserResponse {
  return {
    id: user.id,
    // null for platform Super Admins, who belong to no tenant (RDM).
    organizationId: user.organizationId ?? undefined,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl ? avatarUrls[user.avatarUrl] : undefined,
    email: user.email,
    isEmailVerified: user.isEmailVerified,
    phoneNumber: user.phoneNumber ?? undefined,
    isPhoneVerified: user.isPhoneVerified,
    dob: toIsoDate(user.dob),
    gender: toProtoGender(user.gender),
    lastLoginAt: toProtoTimestamp(user.lastLoginAt),
    isLocked: user.isLocked,
    // Absent means the lock is INDEFINITE — 21-doc §2. Carried so an admin
    // screen can say "locked until Friday" rather than just "locked".
    lockedUntil: toProtoTimestamp(user.lockedUntil),
    isTwoFactorEnabled: user.isTwoFactorEnabled,
    // Non-optional in the proto. ts-proto types every message-valued field as
    // `T | undefined`, which is its convention for message fields -- not
    // permission to omit these.
    createdAt: toProtoTimestamp(user.createdAt),
    updatedAt: toProtoTimestamp(user.updatedAt),
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
  avatarUrls: Record<string, string> = {},
): UserSummaryResponse {
  return {
    user: toUserResponse(user, avatarUrls),
    roleIds: user.roles.map((role) => role.id),
    roleNames: user.roles.map((role) => role.name),
    departmentIds: user.userDepartments.map((ud) => ud.departmentId),
    // Only ever set on a soft-deleted row.
    deletedAt: toProtoTimestamp(user.deletedAt),
    deletedByName: user.deletedBy?.fullName ?? undefined,
  };
}

/**
 * The columns a notification recipient needs, in ONE place.
 *
 * Shared by both audience reads so they cannot drift: the quiet-hours fields
 * were added for `listUsersByIds` and are just as necessary for
 * `listPermissionHolders`, and a second copy would have gained them later or
 * never.
 */
/**
 * What a GraphQL edge is allowed to see — 25-doc §4, 27-doc §3.
 *
 * **No `email`.** `Ticket.assignee` is reachable with ticket access alone, and
 * a user with ticket access and no `user.read` must not come away holding an
 * agent's address. Enforced at the WIRE rather than by a mapper in the gateway:
 * data the gateway never receives is data it cannot leak.
 *
 * `isLocked` and `deletedAt` ride along so the caller can render "Former
 * employee" rather than infer it from an absence it cannot distinguish from a
 * missing row.
 */
export const USER_SUMMARY_SELECT = {
  id: true,
  fullName: true,
  avatarUrl: true,
  isLocked: true,
  deletedAt: true,
} as const;

export function toUserSummary(user: {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  isLocked: boolean;
  deletedAt: Date | null;
}): UserSummary {
  return {
    userId: user.id,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl ?? undefined,
    isLocked: user.isLocked,
    deletedAt: toProtoTimestamp(user.deletedAt),
  };
}

export const NOTIFICATION_RECIPIENT_SELECT = {
  id: true,
  email: true,
  fullName: true,
  quietHoursStart: true,
  quietHoursEnd: true,
  timezone: true,
} as const;

export function toNotificationRecipient(user: {
  id: string;
  email: string;
  fullName: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string | null;
}): NotificationRecipient {
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    // `?? undefined`, not `?? ''`: these are `optional` on the wire, and an
    // empty string would be indistinguishable from a user who set "00:00".
    quietHoursStart: user.quietHoursStart ?? undefined,
    quietHoursEnd: user.quietHoursEnd ?? undefined,
    timezone: user.timezone ?? undefined,
  };
}
