package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * ChangePasswordResponseDto
 */

public class ChangePasswordResponseDto {

  private BigDecimal revokedSessionCount;

  public ChangePasswordResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ChangePasswordResponseDto(BigDecimal revokedSessionCount) {
    this.revokedSessionCount = revokedSessionCount;
  }

  public ChangePasswordResponseDto revokedSessionCount(
    BigDecimal revokedSessionCount
  ) {
    this.revokedSessionCount = revokedSessionCount;
    return this;
  }

  /**
   * Other devices signed out by the change. The caller keeps this session.
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
    ChangePasswordResponseDto changePasswordResponseDto =
      (ChangePasswordResponseDto) o;
    return Objects.equals(
      this.revokedSessionCount,
      changePasswordResponseDto.revokedSessionCount
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(revokedSessionCount);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ChangePasswordResponseDto {\n");
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
