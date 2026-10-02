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
 * UnreadCountResponseDto
 */

public class UnreadCountResponseDto {

  private BigDecimal count;

  public UnreadCountResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public UnreadCountResponseDto(BigDecimal count) {
    this.count = count;
  }

  public UnreadCountResponseDto count(BigDecimal count) {
    this.count = count;
    return this;
  }

  /**
   * Get count
   * @return count
   */
  @NotNull
  @Valid
  @JsonProperty("count")
  public BigDecimal getCount() {
    return count;
  }

  @JsonProperty("count")
  public void setCount(BigDecimal count) {
    this.count = count;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UnreadCountResponseDto unreadCountResponseDto = (UnreadCountResponseDto) o;
    return Objects.equals(this.count, unreadCountResponseDto.count);
  }

  @Override
  public int hashCode() {
    return Objects.hash(count);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UnreadCountResponseDto {\n");
    sb.append("    count: ").append(toIndentedString(count)).append("\n");
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
