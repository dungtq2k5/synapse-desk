package com.synapsedesk.gateway.modules.notifications.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * MarkReadResponseDto
 */

public class MarkReadResponseDto {

  private BigDecimal updated;

  private BigDecimal unreadCount;

  private String countedAt;

  public MarkReadResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public MarkReadResponseDto(BigDecimal updated, BigDecimal unreadCount) {
    this.updated = updated;
    this.unreadCount = unreadCount;
  }

  public MarkReadResponseDto updated(BigDecimal updated) {
    this.updated = updated;
    return this;
  }

  /**
   * Get updated
   * @return updated
   */
  @NotNull
  @Valid
  @JsonProperty("updated")
  public BigDecimal getUpdated() {
    return updated;
  }

  @JsonProperty("updated")
  public void setUpdated(BigDecimal updated) {
    this.updated = updated;
  }

  public MarkReadResponseDto unreadCount(BigDecimal unreadCount) {
    this.unreadCount = unreadCount;
    return this;
  }

  /**
   * Pushed back so a client never recomputes a badge it can be told.
   * @return unreadCount
   */
  @NotNull
  @Valid
  @JsonProperty("unreadCount")
  public BigDecimal getUnreadCount() {
    return unreadCount;
  }

  @JsonProperty("unreadCount")
  public void setUnreadCount(BigDecimal unreadCount) {
    this.unreadCount = unreadCount;
  }

  public MarkReadResponseDto countedAt(String countedAt) {
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
    MarkReadResponseDto markReadResponseDto = (MarkReadResponseDto) o;
    return (
      Objects.equals(this.updated, markReadResponseDto.updated) &&
      Objects.equals(this.unreadCount, markReadResponseDto.unreadCount) &&
      Objects.equals(this.countedAt, markReadResponseDto.countedAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(updated, unreadCount, countedAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class MarkReadResponseDto {\n");
    sb.append("    updated: ").append(toIndentedString(updated)).append("\n");
    sb.append("    unreadCount: ")
      .append(toIndentedString(unreadCount))
      .append("\n");
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
