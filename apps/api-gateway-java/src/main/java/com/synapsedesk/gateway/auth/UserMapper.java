package com.synapsedesk.gateway.auth;

import com.google.protobuf.Timestamp;
import com.synapsedesk.gateway.generated.model.UserResponseDto;
import java.net.URI;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import synapsedesk.auth.Common.Gender;
import synapsedesk.auth.Common.UserResponse;

/**
 * Wire `UserResponse` -> the REST `UserResponseDto` — `user.mapper.ts`,
 * reproduced.
 *
 * <p>Every proto `optional` becomes `null`, never left unset, matching the
 * Node side's commitment to a stable key set.
 */
public final class UserMapper {

  private UserMapper() {}

  public static UserResponseDto toUserResponseDto(UserResponse user) {
    return new UserResponseDto()
        .id(UUID.fromString(user.getId()))
        .organizationId(
            user.hasOrganizationId() ? UUID.fromString(user.getOrganizationId()) : null)
        .fullName(user.getFullName())
        .avatarUrl(user.hasAvatarUrl() ? URI.create(user.getAvatarUrl()) : null)
        .email(user.getEmail())
        .isEmailVerified(user.getIsEmailVerified())
        .phoneNumber(user.hasPhoneNumber() ? user.getPhoneNumber() : null)
        .isPhoneVerified(user.getIsPhoneVerified())
        .dob(user.hasDob() ? user.getDob() : null)
        .gender(fromProtoGender(user.getGender()))
        .lastLoginAt(user.hasLastLoginAt() ? toOffsetDateTime(user.getLastLoginAt()) : null)
        .isLocked(user.getIsLocked())
        .lockedUntil(user.hasLockedUntil() ? toOffsetDateTime(user.getLockedUntil()) : null)
        .isTwoFactorEnabled(user.getIsTwoFactorEnabled())
        .createdAt(toOffsetDateTime(user.getCreatedAt()))
        .updatedAt(toOffsetDateTime(user.getUpdatedAt()));
  }

  /** `GENDER_MALE` -> `MALE` — the REST enum is the proto one, prefix stripped. */
  private static UserResponseDto.GenderEnum fromProtoGender(Gender gender) {
    return UserResponseDto.GenderEnum.fromValue(gender.name().substring("GENDER_".length()));
  }

  private static OffsetDateTime toOffsetDateTime(Timestamp timestamp) {
    return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos())
        .atOffset(ZoneOffset.UTC);
  }
}
