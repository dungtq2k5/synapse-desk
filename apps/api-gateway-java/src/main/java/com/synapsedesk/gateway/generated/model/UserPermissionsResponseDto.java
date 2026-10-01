package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * UserPermissionsResponseDto
 */

public class UserPermissionsResponseDto {

  private List<String> permissionCodes = new ArrayList<>();

  public UserPermissionsResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public UserPermissionsResponseDto(List<String> permissionCodes) {
    this.permissionCodes = permissionCodes;
  }

  public UserPermissionsResponseDto permissionCodes(List<String> permissionCodes) {
    this.permissionCodes = permissionCodes;
    return this;
  }

  public UserPermissionsResponseDto addPermissionCodesItem(String permissionCodesItem) {
    if (this.permissionCodes == null) {
      this.permissionCodes = new ArrayList<>();
    }
    this.permissionCodes.add(permissionCodesItem);
    return this;
  }

  /**
   * Get permissionCodes
   * @return permissionCodes
   */
  @NotNull 
  @JsonProperty("permissionCodes")
  public List<String> getPermissionCodes() {
    return permissionCodes;
  }

  @JsonProperty("permissionCodes")
  public void setPermissionCodes(List<String> permissionCodes) {
    this.permissionCodes = permissionCodes;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UserPermissionsResponseDto userPermissionsResponseDto = (UserPermissionsResponseDto) o;
    return Objects.equals(this.permissionCodes, userPermissionsResponseDto.permissionCodes);
  }

  @Override
  public int hashCode() {
    return Objects.hash(permissionCodes);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UserPermissionsResponseDto {\n");
    sb.append("    permissionCodes: ").append(toIndentedString(permissionCodes)).append("\n");
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

