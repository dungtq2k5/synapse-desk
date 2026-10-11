package com.synapsedesk.gateway.modules.roles.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * AssignRoleUsersDto
 */

public class AssignRoleUsersDto {

  private List<UUID> userIds = new ArrayList<>();

  public AssignRoleUsersDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AssignRoleUsersDto(List<UUID> userIds) {
    this.userIds = userIds;
  }

  public AssignRoleUsersDto userIds(List<UUID> userIds) {
    this.userIds = userIds;
    return this;
  }

  public AssignRoleUsersDto addUserIdsItem(UUID userIdsItem) {
    if (this.userIds == null) {
      this.userIds = new ArrayList<>();
    }
    this.userIds.add(userIdsItem);
    return this;
  }

  /**
   * Get userIds
   * @return userIds
   */
  @NotNull
  @Valid
  @Size(min = 1, max = 50)
  @JsonProperty("userIds")
  public List<UUID> getUserIds() {
    return userIds;
  }

  @JsonProperty("userIds")
  public void setUserIds(List<UUID> userIds) {
    this.userIds = userIds;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AssignRoleUsersDto assignRoleUsersDto = (AssignRoleUsersDto) o;
    return Objects.equals(this.userIds, assignRoleUsersDto.userIds);
  }

  @Override
  public int hashCode() {
    return Objects.hash(userIds);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AssignRoleUsersDto {\n");
    sb.append("    userIds: ").append(toIndentedString(userIds)).append("\n");
    sb.append("}");
    return sb.toString();
  }

  /**
   * Convert the given object to string with each line indented by 4 spaces
   * (except the first line).
   */
  private String toIndentedString(@Nullable Object o) {
    return o == null ? "null" : o.toString().replace("\n", "\n    ");
  }
}
