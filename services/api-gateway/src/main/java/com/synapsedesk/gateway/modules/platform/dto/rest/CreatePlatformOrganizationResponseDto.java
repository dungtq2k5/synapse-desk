package com.synapsedesk.gateway.modules.platform.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.common.dto.UserResponseDto;
import com.synapsedesk.gateway.modules.platform.dto.rest.PlatformOrganizationResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * CreatePlatformOrganizationResponseDto
 */

public class CreatePlatformOrganizationResponseDto {

  private PlatformOrganizationResponseDto organization;

  private UserResponseDto admin;

  public CreatePlatformOrganizationResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreatePlatformOrganizationResponseDto(
    PlatformOrganizationResponseDto organization,
    UserResponseDto admin
  ) {
    this.organization = organization;
    this.admin = admin;
  }

  public CreatePlatformOrganizationResponseDto organization(
    PlatformOrganizationResponseDto organization
  ) {
    this.organization = organization;
    return this;
  }

  /**
   * Get organization
   * @return organization
   */
  @NotNull
  @Valid
  @JsonProperty("organization")
  public PlatformOrganizationResponseDto getOrganization() {
    return organization;
  }

  @JsonProperty("organization")
  public void setOrganization(PlatformOrganizationResponseDto organization) {
    this.organization = organization;
  }

  public CreatePlatformOrganizationResponseDto admin(UserResponseDto admin) {
    this.admin = admin;
    return this;
  }

  /**
   * Get admin
   * @return admin
   */
  @NotNull
  @Valid
  @JsonProperty("admin")
  public UserResponseDto getAdmin() {
    return admin;
  }

  @JsonProperty("admin")
  public void setAdmin(UserResponseDto admin) {
    this.admin = admin;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    CreatePlatformOrganizationResponseDto createPlatformOrganizationResponseDto =
      (CreatePlatformOrganizationResponseDto) o;
    return (
      Objects.equals(
        this.organization,
        createPlatformOrganizationResponseDto.organization
      ) &&
      Objects.equals(this.admin, createPlatformOrganizationResponseDto.admin)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(organization, admin);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreatePlatformOrganizationResponseDto {\n");
    sb.append("    organization: ")
      .append(toIndentedString(organization))
      .append("\n");
    sb.append("    admin: ").append(toIndentedString(admin)).append("\n");
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
