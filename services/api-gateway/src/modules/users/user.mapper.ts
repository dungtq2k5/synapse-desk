import {
  CurrentUserResponse,
  fromProtoGender,
  fromProtoTimestamp,
  ListUsersRequest,
  ListUsersResponse,
  LockUserRequest,
  PresignAvatarUploadResponse,
  requireField,
  requireProtoTimestamp,
  toPageRequest,
  toProtoGender,
  toProtoTimestamp,
  UserResponse,
  UserSummary,
  UserSummaryResponse,
} from '@synapsedesk/grpc-proto';
import { PermissionCode } from '@synapsedesk/common';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import { PresignAvatarResponseDto } from './dto/rest/avatar-response.dto';
import {
  CurrentUserResponseDto,
  UserResponseDto,
} from './dto/rest/user-response.dto';
import { ListUsersQueryDto, LockUserDto } from './dto/rest/user-admin.dto';
import { UserSummaryResponseDto } from './dto/rest/user-admin-response.dto';
import {
  UserSummaryResponseGqlDto,
  UserResponseGqlDto,
} from './dto/graphql/user-response.gql-dto';

/**
 * Wire `UserResponse` -> the REST `UserResponseDto`.
 *
 * Every optional field is converted to `null`, never left `undefined`: the REST
 * contract commits to a stable key set, which is what `@IsNullable()` on
 * `UserResponseDto` and the published OpenAPI schema both describe.
 *
 * @example
 * const dto = toUserResponseDto(await client.get(id, context));
 *
 * @param user - the message off the wire
 * @returns the REST DTO, with every optional field present as `null`
 * @throws Error if `createdAt` or `updatedAt` is missing, which the proto requires
 */
export function toUserResponseDto(user: UserResponse): UserResponseDto {
  return {
    id: user.id,
    organizationId: user.organizationId ?? null,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl ?? null,
    email: user.email,
    isEmailVerified: user.isEmailVerified,
    phoneNumber: user.phoneNumber ?? null,
    isPhoneVerified: user.isPhoneVerified,
    dob: user.dob ?? null,
    gender: fromProtoGender(user.gender),
    lastLoginAt: fromProtoTimestamp(user.lastLoginAt) ?? null,
    isLocked: user.isLocked,
    lockedUntil: fromProtoTimestamp(user.lockedUntil) ?? null,
    isTwoFactorEnabled: user.isTwoFactorEnabled,
    // Non-optional in the proto, so a missing value is a contract violation
    // rather than something to paper over with a fallback date.
    createdAt: requireProtoTimestamp(user.createdAt, 'createdAt'),
    updatedAt: requireProtoTimestamp(user.updatedAt, 'updatedAt'),
  };
}

/** Wire -> REST for an admin list row. */
export function toUserSummaryResponseDto(
  summary: UserSummaryResponse,
): UserSummaryResponseDto {
  return {
    user: toUserResponseDto(summary.user!),
    roleIds: summary.roleIds,
    roleNames: summary.roleNames,
    departmentIds: summary.departmentIds,
    deletedAt: fromProtoTimestamp(summary.deletedAt) ?? null,
    deletedByName: summary.deletedByName ?? null,
  };
}

/**
 * Wire `UserSummary` -> the GraphQL `UserSummary` edge type, used for
 * `Ticket.assignee`, `Ticket.author`, `TicketMessage.sender`,
 * `Notification.actor`, `Document.createdBy` and `AgentStat.agent`.
 *
 * Called by `createUserSummaryLoader`, so a resolver reaches an edge through
 * `loaders.users.load(id)` and never maps for itself. A missing id is the
 * loader's `null`, not this function's.
 *
 * Not to be confused with {@link toUserSummaryResponseDto}, which returns the
 * ADMIN summary — a user plus their roles and departments.
 *
 * @example
 * const rows = response.summaries.map((s) => toUserSummaryResponseGqlDto(s));
 *
 * @param user - one summary row off the wire
 * @returns the edge type the GraphQL schema declares
 */
export function toUserSummaryResponseGqlDto(
  user: UserSummary,
): UserSummaryResponseGqlDto {
  return {
    id: user.userId,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl ?? null,
    isLocked: user.isLocked,
    deletedAt: fromProtoTimestamp(user.deletedAt) ?? null,
  };
}

/**
 * The user envelope -> the FLAT shape the GraphQL `User` type declares.
 *
 * The envelope nests the user under `.user` and carries `departmentIds` beside
 * it; this flattens the two into one object. `departmentIds` is kept because
 * `User.departments` resolves off the parent.
 *
 * Used by the `getCurrentUserGql`, `getGql` and `listGql` methods on
 * {@link UsersService}, so a resolver returns the value as it stands.
 *
 * @example
 * const user = toUserResponseGqlDto(await this.get(id, context));
 *
 * @param source - any envelope carrying a user and its department ids
 * @returns the flat `User` the GraphQL schema declares
 */
export function toUserResponseGqlDto(source: {
  user: UserResponseDto;
  departmentIds: string[];
}): UserResponseGqlDto {
  return { ...source.user, departmentIds: source.departmentIds };
}

/**
 * Builds the profile half of an `UpdateUser` request, shared by the own-profile
 * and admin routes.
 *
 * A `null` field becomes the empty string, which the service reads as "clear
 * it"; an absent field stays absent, which it reads as "leave unchanged".
 */
export function toProfileFields(dto: {
  fullName?: string;
  gender?: string;
  dob?: string | null;
}) {
  return {
    fullName: dto.fullName,
    gender: dto.gender === undefined ? undefined : toProtoGender(dto.gender),
    dob: dto.dob === null ? '' : dto.dob,
  };
}

/** Builds a `ListUsersRequest` from the REST query. */
export function toListUsersRequest(query: ListUsersQueryDto): ListUsersRequest {
  return {
    page: toPageRequest(query),
    departmentId: query.departmentId,
    roleId: query.roleId,
    isLocked: query.isLocked,
    includeDeleted: query.includeDeleted,
  };
}

/** Builds a `LockUserRequest`. An absent `lockedUntil` means an indefinite lock. */
export function toLockUserRequest(
  id: string,
  dto: LockUserDto,
): LockUserRequest {
  return {
    id,
    reason: dto.reason,
    lockedUntil: dto.lockedUntil
      ? toProtoTimestamp(new Date(dto.lockedUntil))
      : undefined,
  };
}

/**
 * Converts a `GetCurrentUserResponse` off the wire into its REST DTO.
 *
 * `permissionCodes` is narrowed here: the proto declares `repeated string`, and
 * the codes come from our own seeded catalogue rather than from user input.
 *
 * @throws Error if the response carries no user, which the proto requires.
 */
export function toCurrentUserResponseDto(
  response: CurrentUserResponse,
): CurrentUserResponseDto {
  return {
    user: toUserResponseDto(requireField(response.user, 'user')),
    permissionCodes: response.permissionCodes as PermissionCode[],
    departmentIds: response.departmentIds,
  };
}

/** Converts a `ListUsersResponse` into the paginated REST envelope. */
export function toUserSummaryPageDto(
  response: ListUsersResponse,
): PaginationResponseDto<UserSummaryResponseDto> {
  return {
    items: response.items.map(toUserSummaryResponseDto),
    meta: toPaginationMetaDataResponseDto(response.meta),
  };
}

/**
 * Converts a `PresignAvatarUploadResponse` off the wire into its REST DTO.
 *
 * @throws Error if `expiresAt` is missing, which the proto requires.
 */
export function toPresignAvatarResponseDto(
  response: PresignAvatarUploadResponse,
): PresignAvatarResponseDto {
  return {
    uploadUrl: response.uploadUrl,
    objectPath: response.objectPath,
    expiresAt: requireProtoTimestamp(response.expiresAt, 'expiresAt'),
  };
}
