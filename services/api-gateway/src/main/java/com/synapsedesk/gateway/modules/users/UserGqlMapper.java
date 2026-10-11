package com.synapsedesk.gateway.modules.users;

import com.google.protobuf.Timestamp;
import com.synapsedesk.gateway.common.graphql.PageMetaGqlDto;
import com.synapsedesk.gateway.modules.users.dto.graphql.GenderGql;
import com.synapsedesk.gateway.modules.users.dto.graphql.UserGqlDto;
import com.synapsedesk.gateway.modules.users.dto.graphql.UserPageGqlDto;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import synapsedesk.auth.Common.Gender;
import synapsedesk.auth.Common.PageMeta;
import synapsedesk.auth.Common.UserResponse;
import synapsedesk.auth.User.CurrentUserResponse;
import synapsedesk.auth.User.ListUsersResponse;
import synapsedesk.auth.User.UserSummaryResponse;

/**
 * Wire -> the flat GraphQL `User`. Every envelope this gateway reads for a
 * `User` nests the user under `.user` and carries `departmentIds` beside it,
 * so a naive `current.user` read would drop `departmentIds`.
 */
public final class UserGqlMapper {

  private UserGqlMapper() {}

  public static UserGqlDto toUserGqlDto(CurrentUserResponse response) {
    return toUserGqlDto(response.getUser(), response.getDepartmentIdsList());
  }

  public static UserGqlDto toUserGqlDto(UserSummaryResponse response) {
    return toUserGqlDto(response.getUser(), response.getDepartmentIdsList());
  }

  public static UserPageGqlDto toUserPageGqlDto(ListUsersResponse response) {
    return new UserPageGqlDto(
      response
        .getItemsList()
        .stream()
        .map(UserGqlMapper::toUserGqlDto)
        .toList(),
      toPageMetaGqlDto(response.getMeta())
    );
  }

  private static UserGqlDto toUserGqlDto(
    UserResponse user,
    List<String> departmentIds
  ) {
    return new UserGqlDto(
      user.getId(),
      user.hasOrganizationId() ? user.getOrganizationId() : null,
      departmentIds,
      user.getFullName(),
      user.hasAvatarUrl() ? user.getAvatarUrl() : null,
      user.getEmail(),
      user.getIsEmailVerified(),
      user.hasPhoneNumber() ? user.getPhoneNumber() : null,
      user.getIsPhoneVerified(),
      user.hasDob() ? user.getDob() : null,
      fromProtoGender(user.getGender()),
      user.hasLastLoginAt() ? toOffsetDateTime(user.getLastLoginAt()) : null,
      user.getIsLocked(),
      user.hasLockedUntil() ? toOffsetDateTime(user.getLockedUntil()) : null,
      user.getIsTwoFactorEnabled(),
      toOffsetDateTime(user.getCreatedAt()),
      toOffsetDateTime(user.getUpdatedAt())
    );
  }

  /** `GENDER_MALE` -> `MALE` — the same prefix strip as {@code UserMapper.fromProtoGender}. */
  private static GenderGql fromProtoGender(Gender gender) {
    return GenderGql.valueOf(gender.name().substring("GENDER_".length()));
  }

  private static PageMetaGqlDto toPageMetaGqlDto(PageMeta meta) {
    return new PageMetaGqlDto(
      meta.getTotalItems(),
      meta.getItemCount(),
      meta.getItemsPerPage(),
      meta.getTotalPages(),
      meta.getCurrentPage()
    );
  }

  private static OffsetDateTime toOffsetDateTime(Timestamp timestamp) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }
}
