package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonTypeName;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * TwoFactorRequiredResponseDto
 */

public class TwoFactorRequiredResponseDto {

  private Boolean requiresTwoFactor;

  private Boolean requiresTwoFactorSetup;

  public TwoFactorRequiredResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public TwoFactorRequiredResponseDto(
    Boolean requiresTwoFactor,
    Boolean requiresTwoFactorSetup
  ) {
    this.requiresTwoFactor = requiresTwoFactor;
    this.requiresTwoFactorSetup = requiresTwoFactorSetup;
  }

  public TwoFactorRequiredResponseDto requiresTwoFactor(
    Boolean requiresTwoFactor
  ) {
    this.requiresTwoFactor = requiresTwoFactor;
    return this;
  }

  /**
   * Get requiresTwoFactor
   * @return requiresTwoFactor
   */
  @NotNull
  @JsonProperty("requiresTwoFactor")
  public Boolean getRequiresTwoFactor() {
    return requiresTwoFactor;
  }

  @JsonProperty("requiresTwoFactor")
  public void setRequiresTwoFactor(Boolean requiresTwoFactor) {
    this.requiresTwoFactor = requiresTwoFactor;
  }

  public TwoFactorRequiredResponseDto requiresTwoFactorSetup(
    Boolean requiresTwoFactorSetup
  ) {
    this.requiresTwoFactorSetup = requiresTwoFactorSetup;
    return this;
  }

  /**
   * True when the tenant REQUIRES 2FA and this account has not enrolled.  The client must branch on it: `false` means prompt for a code, `true` means open the enrolment screen and call `POST /auth/2fa/setup` — which accepts the challenge cookie precisely for this case. Showing a code box here would ask for a code that does not exist yet, which is how a tenant-wide `enforce_two_factor` becomes a tenant-wide lockout.
   * @return requiresTwoFactorSetup
   */
  @NotNull
  @JsonProperty("requiresTwoFactorSetup")
  public Boolean getRequiresTwoFactorSetup() {
    return requiresTwoFactorSetup;
  }

  @JsonProperty("requiresTwoFactorSetup")
  public void setRequiresTwoFactorSetup(Boolean requiresTwoFactorSetup) {
    this.requiresTwoFactorSetup = requiresTwoFactorSetup;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    TwoFactorRequiredResponseDto twoFactorRequiredResponseDto =
      (TwoFactorRequiredResponseDto) o;
    return (
      Objects.equals(
        this.requiresTwoFactor,
        twoFactorRequiredResponseDto.requiresTwoFactor
      ) &&
      Objects.equals(
        this.requiresTwoFactorSetup,
        twoFactorRequiredResponseDto.requiresTwoFactorSetup
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(requiresTwoFactor, requiresTwoFactorSetup);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class TwoFactorRequiredResponseDto {\n");
    sb.append("    requiresTwoFactor: ")
      .append(toIndentedString(requiresTwoFactor))
      .append("\n");
    sb.append("    requiresTwoFactorSetup: ")
      .append(toIndentedString(requiresTwoFactorSetup))
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
