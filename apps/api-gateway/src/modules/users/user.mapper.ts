import {
  fromProtoGender,
  fromTimestamp,
  requireTimestamp,
  UserResponse,
  UserSummaryResponse,
} from '@synapsedesk/grpc-proto';
import { UserResponseDto } from './dto/rest/user-response.dto';
import { UserSummaryResponseDto } from './dto/rest/user-admin.dto';

/**
 * Wire -> REST boundary, the mirror of auth-service's `toUserResponse`.
 *
 * protobuf has no null, so an unset field arrives as `undefined`. The REST
 * contract commits to `null` instead — that is what `@IsNullable()` on
 * `UserBase` already assumes, and it means a client (or an OpenAPI schema) sees
 * a stable key set rather than fields that vanish. So every optional field is
 * converted deliberately here.
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
    lastLoginAt: fromTimestamp(user.lastLoginAt) ?? null,
    isLocked: user.isLocked,
    isTwoFactorEnabled: user.isTwoFactorEnabled,
    // Non-optional in the proto, so a missing value is a contract violation
    // rather than something to paper over with a fallback date.
    createdAt: requireTimestamp(user.createdAt, 'createdAt'),
    updatedAt: requireTimestamp(user.updatedAt, 'updatedAt'),
  };
}

/** Wire -> REST for an admin list row. */
export function toUserSummaryDto(
  summary: UserSummaryResponse,
): UserSummaryResponseDto {
  return {
    user: toUserResponseDto(summary.user!),
    roleIds: summary.roleIds,
    roleNames: summary.roleNames,
    departmentIds: summary.departmentIds,
    deletedAt: fromTimestamp(summary.deletedAt) ?? null,
    deletedByName: summary.deletedByName ?? null,
  };
}
