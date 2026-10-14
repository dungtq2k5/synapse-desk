package com.synapsedesk.gateway.modules.auth.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * What the register route returns: the same for an address that already has an
 * account as for a new one, so it carries no ids.
 */

public class RegisterResponseDto {

  private String email;

  private Boolean requiresEmailVerification;

  public RegisterResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public RegisterResponseDto(String email, Boolean requiresEmailVerification) {
    this.email = email;
    this.requiresEmailVerification = requiresEmailVerification;
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

  public RegisterResponseDto requiresEmailVerification(
    Boolean requiresEmailVerification
  ) {
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
    return (
      Objects.equals(this.email, registerResponseDto.email) &&
      Objects.equals(
        this.requiresEmailVerification,
        registerResponseDto.requiresEmailVerification
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(email, requiresEmailVerification);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class RegisterResponseDto {\n");
    sb.append("    email: ").append(toIndentedString(email)).append("\n");
    sb.append("    requiresEmailVerification: ")
      .append(toIndentedString(requiresEmailVerification))
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
