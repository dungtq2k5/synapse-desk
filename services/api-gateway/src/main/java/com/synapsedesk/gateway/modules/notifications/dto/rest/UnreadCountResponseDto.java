package com.synapsedesk.gateway.modules.notifications.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * UnreadCountResponseDto
 */

public class UnreadCountResponseDto {

  private BigDecimal count;

  private String countedAt;

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

  public UnreadCountResponseDto countedAt(String countedAt) {
    this.countedAt = countedAt;
    return this;
  }

  /**
   * When the database counted it (ISO 8601). A client keeps the newest count
   * it has, from any answer, refetch or push, and drops an older one that
   * arrives later.
   * @return countedAt
   */
  @NotNull
  @JsonProperty("countedAt")
  public String getCountedAt() {
    return countedAt;
  }

  @JsonProperty("countedAt")
  public void setCountedAt(String countedAt) {
    this.countedAt = countedAt;
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
    return (
      Objects.equals(this.count, unreadCountResponseDto.count) &&
      Objects.equals(this.countedAt, unreadCountResponseDto.countedAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(count, countedAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UnreadCountResponseDto {\n");
    sb.append("    count: ").append(toIndentedString(count)).append("\n");
    sb.append("    countedAt: ")
      .append(toIndentedString(countedAt))
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
