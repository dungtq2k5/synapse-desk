package com.synapsedesk.gateway.modules.auth.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * LoginWithTenantDto
 */

public class LoginWithTenantDto {

  private UUID organizationId;

  private @Nullable String deviceName;

  public LoginWithTenantDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public LoginWithTenantDto(UUID organizationId) {
    this.organizationId = organizationId;
  }

  public LoginWithTenantDto organizationId(UUID organizationId) {
    this.organizationId = organizationId;
    return this;
  }

  /**
   * Get organizationId
   * @return organizationId
   */
  @NotNull
  @Valid
  @JsonProperty("organizationId")
  public UUID getOrganizationId() {
    return organizationId;
  }

  @JsonProperty("organizationId")
  public void setOrganizationId(UUID organizationId) {
    this.organizationId = organizationId;
  }

  public LoginWithTenantDto deviceName(@Nullable String deviceName) {
    this.deviceName = deviceName;
    return this;
  }

  /**
   * Get deviceName
   * @return deviceName
   */
  @Size(max = 100)
  @JsonProperty("deviceName")
  public @Nullable String getDeviceName() {
    return deviceName;
  }

  @JsonProperty("deviceName")
  public void setDeviceName(@Nullable String deviceName) {
    this.deviceName = deviceName;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    LoginWithTenantDto loginWithTenantDto = (LoginWithTenantDto) o;
    return (
      Objects.equals(this.organizationId, loginWithTenantDto.organizationId) &&
      Objects.equals(this.deviceName, loginWithTenantDto.deviceName)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(organizationId, deviceName);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class LoginWithTenantDto {\n");
    sb.append("    organizationId: ")
      .append(toIndentedString(organizationId))
      .append("\n");
    sb.append("    deviceName: ")
      .append(toIndentedString(deviceName))
      .append("\n");
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
