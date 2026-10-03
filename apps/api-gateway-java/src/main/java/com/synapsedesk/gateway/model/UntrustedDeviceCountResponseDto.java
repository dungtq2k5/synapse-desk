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
import org.jspecify.annotations.Nullable;

/**
 * UntrustedDeviceCountResponseDto
 */

public class UntrustedDeviceCountResponseDto {

  private BigDecimal untrustedDeviceCount;

  public UntrustedDeviceCountResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public UntrustedDeviceCountResponseDto(BigDecimal untrustedDeviceCount) {
    this.untrustedDeviceCount = untrustedDeviceCount;
  }

  public UntrustedDeviceCountResponseDto untrustedDeviceCount(
    BigDecimal untrustedDeviceCount
  ) {
    this.untrustedDeviceCount = untrustedDeviceCount;
    return this;
  }

  /**
   * Get untrustedDeviceCount
   * @return untrustedDeviceCount
   */
  @NotNull
  @Valid
  @JsonProperty("untrustedDeviceCount")
  public BigDecimal getUntrustedDeviceCount() {
    return untrustedDeviceCount;
  }

  @JsonProperty("untrustedDeviceCount")
  public void setUntrustedDeviceCount(BigDecimal untrustedDeviceCount) {
    this.untrustedDeviceCount = untrustedDeviceCount;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UntrustedDeviceCountResponseDto untrustedDeviceCountResponseDto =
      (UntrustedDeviceCountResponseDto) o;
    return Objects.equals(
      this.untrustedDeviceCount,
      untrustedDeviceCountResponseDto.untrustedDeviceCount
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(untrustedDeviceCount);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UntrustedDeviceCountResponseDto {\n");
    sb.append("    untrustedDeviceCount: ")
      .append(toIndentedString(untrustedDeviceCount))
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
