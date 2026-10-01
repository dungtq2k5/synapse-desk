package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.math.BigDecimal;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * RevokedSessionCountResponseDto
 */

public class RevokedSessionCountResponseDto {

  private BigDecimal revokedSessionCount;

  public RevokedSessionCountResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public RevokedSessionCountResponseDto(BigDecimal revokedSessionCount) {
    this.revokedSessionCount = revokedSessionCount;
  }

  public RevokedSessionCountResponseDto revokedSessionCount(BigDecimal revokedSessionCount) {
    this.revokedSessionCount = revokedSessionCount;
    return this;
  }

  /**
   * Get revokedSessionCount
   * @return revokedSessionCount
   */
  @NotNull @Valid 
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
    RevokedSessionCountResponseDto revokedSessionCountResponseDto = (RevokedSessionCountResponseDto) o;
    return Objects.equals(this.revokedSessionCount, revokedSessionCountResponseDto.revokedSessionCount);
  }

  @Override
  public int hashCode() {
    return Objects.hash(revokedSessionCount);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class RevokedSessionCountResponseDto {\n");
    sb.append("    revokedSessionCount: ").append(toIndentedString(revokedSessionCount)).append("\n");
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

