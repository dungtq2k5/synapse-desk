package com.synapsedesk.gateway.modules.auth.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * ResetPasswordResponseDto
 */

public class ResetPasswordResponseDto {

  private BigDecimal revokedSessionCount;

  public ResetPasswordResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ResetPasswordResponseDto(BigDecimal revokedSessionCount) {
    this.revokedSessionCount = revokedSessionCount;
  }

  public ResetPasswordResponseDto revokedSessionCount(
    BigDecimal revokedSessionCount
  ) {
    this.revokedSessionCount = revokedSessionCount;
    return this;
  }

  /**
   * Surfaced so the UI can say \"you have been signed out of N devices\".
   * @return revokedSessionCount
   */
  @NotNull
  @Valid
  @JsonProperty("revokedSessionCount")
  public BigDecimal getRevokedSessionCount() {
    return revokedSessionCount;
  }

  @JsonProperty("revokedSessionCount")
  public void setRevokedSessionCount(BigDecimal revokedSessionCount) {
    this.revokedSessionCount = revokedSessionCount;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    ResetPasswordResponseDto resetPasswordResponseDto =
      (ResetPasswordResponseDto) o;
    return Objects.equals(
      this.revokedSessionCount,
      resetPasswordResponseDto.revokedSessionCount
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(revokedSessionCount);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ResetPasswordResponseDto {\n");
    sb.append("    revokedSessionCount: ")
      .append(toIndentedString(revokedSessionCount))
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
