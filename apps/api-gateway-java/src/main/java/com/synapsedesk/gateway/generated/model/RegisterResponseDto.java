package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * RegisterResponseDto
 */

public class RegisterResponseDto {

  private String userId;

  private String organizationId;

  private String email;

  private Boolean requiresEmailVerification;

  public RegisterResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public RegisterResponseDto(String userId, String organizationId, String email, Boolean requiresEmailVerification) {
    this.userId = userId;
    this.organizationId = organizationId;
    this.email = email;
    this.requiresEmailVerification = requiresEmailVerification;
  }

  public RegisterResponseDto userId(String userId) {
    this.userId = userId;
    return this;
  }

  /**
   * Get userId
   * @return userId
   */
  @NotNull 
  @JsonProperty("userId")
  public String getUserId() {
    return userId;
  }

  @JsonProperty("userId")
  public void setUserId(String userId) {
    this.userId = userId;
  }

  public RegisterResponseDto organizationId(String organizationId) {
    this.organizationId = organizationId;
    return this;
  }

  /**
   * Get organizationId
   * @return organizationId
   */
  @NotNull 
  @JsonProperty("organizationId")
  public String getOrganizationId() {
    return organizationId;
  }

  @JsonProperty("organizationId")
  public void setOrganizationId(String organizationId) {
    this.organizationId = organizationId;
  }

  public RegisterResponseDto email(String email) {
    this.email = email;
    return this;
  }

  /**
   * Get email
   * @return email
   */
  @NotNull 
  @JsonProperty("email")
  public String getEmail() {
    return email;
  }

  @JsonProperty("email")
  public void setEmail(String email) {
    this.email = email;
  }

  public RegisterResponseDto requiresEmailVerification(Boolean requiresEmailVerification) {
    this.requiresEmailVerification = requiresEmailVerification;
    return this;
  }

  /**
   * Get requiresEmailVerification
   * @return requiresEmailVerification
   */
  @NotNull 
  @JsonProperty("requiresEmailVerification")
  public Boolean getRequiresEmailVerification() {
    return requiresEmailVerification;
  }

  @JsonProperty("requiresEmailVerification")
  public void setRequiresEmailVerification(Boolean requiresEmailVerification) {
    this.requiresEmailVerification = requiresEmailVerification;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    RegisterResponseDto registerResponseDto = (RegisterResponseDto) o;
    return Objects.equals(this.userId, registerResponseDto.userId) &&
        Objects.equals(this.organizationId, registerResponseDto.organizationId) &&
        Objects.equals(this.email, registerResponseDto.email) &&
        Objects.equals(this.requiresEmailVerification, registerResponseDto.requiresEmailVerification);
  }

  @Override
  public int hashCode() {
    return Objects.hash(userId, organizationId, email, requiresEmailVerification);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class RegisterResponseDto {\n");
    sb.append("    userId: ").append(toIndentedString(userId)).append("\n");
    sb.append("    organizationId: ").append(toIndentedString(organizationId)).append("\n");
    sb.append("    email: ").append(toIndentedString(email)).append("\n");
    sb.append("    requiresEmailVerification: ").append(toIndentedString(requiresEmailVerification)).append("\n");
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

