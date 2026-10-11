package com.synapsedesk.gateway.modules.departments.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
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
 * AddDepartmentMembersDto
 */

public class AddDepartmentMembersDto {

  private Boolean isPrimary = false;

  private List<UUID> userIds = new ArrayList<>();

  public AddDepartmentMembersDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AddDepartmentMembersDto(List<UUID> userIds) {
    this.userIds = userIds;
  }

  public AddDepartmentMembersDto isPrimary(Boolean isPrimary) {
    this.isPrimary = isPrimary;
    return this;
  }

  /**
   * Makes THIS department primary for every user in the batch. A user has at most one primary, so setting it here demotes whichever they had.
   * @return isPrimary
   */

  @Schema(defaultValue = "false")
  @JsonProperty("isPrimary")
  public Boolean getIsPrimary() {
    return isPrimary;
  }

  @JsonProperty("isPrimary")
  public void setIsPrimary(Boolean isPrimary) {
    this.isPrimary = isPrimary;
  }

  public AddDepartmentMembersDto userIds(List<UUID> userIds) {
    this.userIds = userIds;
    return this;
  }

  public AddDepartmentMembersDto addUserIdsItem(UUID userIdsItem) {
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
  @Size(min = 1)
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
    AddDepartmentMembersDto addDepartmentMembersDto =
      (AddDepartmentMembersDto) o;
    return (
      Objects.equals(this.isPrimary, addDepartmentMembersDto.isPrimary) &&
      Objects.equals(this.userIds, addDepartmentMembersDto.userIds)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(isPrimary, userIds);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AddDepartmentMembersDto {\n");
    sb.append("    isPrimary: ")
      .append(toIndentedString(isPrimary))
      .append("\n");
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
