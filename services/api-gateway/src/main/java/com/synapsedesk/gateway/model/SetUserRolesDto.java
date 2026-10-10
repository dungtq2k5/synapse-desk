package com.synapsedesk.gateway.model;

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
 * SetUserRolesDto
 */

public class SetUserRolesDto {

  private List<UUID> roleIds = new ArrayList<>();

  public SetUserRolesDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SetUserRolesDto(List<UUID> roleIds) {
    this.roleIds = roleIds;
  }

  public SetUserRolesDto roleIds(List<UUID> roleIds) {
    this.roleIds = roleIds;
    return this;
  }

  public SetUserRolesDto addRoleIdsItem(UUID roleIdsItem) {
    if (this.roleIds == null) {
      this.roleIds = new ArrayList<>();
    }
    this.roleIds.add(roleIdsItem);
    return this;
  }

  /**
   * Get roleIds
   * @return roleIds
   */
  @NotNull
  @Valid
  @Size(max = 50)
  @JsonProperty("roleIds")
  public List<UUID> getRoleIds() {
    return roleIds;
  }

  @JsonProperty("roleIds")
  public void setRoleIds(List<UUID> roleIds) {
    this.roleIds = roleIds;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    SetUserRolesDto setUserRolesDto = (SetUserRolesDto) o;
    return Objects.equals(this.roleIds, setUserRolesDto.roleIds);
  }

  @Override
  public int hashCode() {
    return Objects.hash(roleIds);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SetUserRolesDto {\n");
    sb.append("    roleIds: ").append(toIndentedString(roleIds)).append("\n");
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
