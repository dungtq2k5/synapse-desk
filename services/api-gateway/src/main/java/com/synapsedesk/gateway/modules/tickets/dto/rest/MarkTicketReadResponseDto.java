package com.synapsedesk.gateway.modules.tickets.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * MarkTicketReadResponseDto
 */

public class MarkTicketReadResponseDto {

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime lastReadAt;

  public MarkTicketReadResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public MarkTicketReadResponseDto(OffsetDateTime lastReadAt) {
    this.lastReadAt = lastReadAt;
  }

  public MarkTicketReadResponseDto lastReadAt(OffsetDateTime lastReadAt) {
    this.lastReadAt = lastReadAt;
    return this;
  }

  /**
   * Get lastReadAt
   * @return lastReadAt
   */
  @NotNull
  @Valid
  @JsonProperty("lastReadAt")
  public OffsetDateTime getLastReadAt() {
    return lastReadAt;
  }

  @JsonProperty("lastReadAt")
  public void setLastReadAt(OffsetDateTime lastReadAt) {
    this.lastReadAt = lastReadAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    MarkTicketReadResponseDto markTicketReadResponseDto =
      (MarkTicketReadResponseDto) o;
    return Objects.equals(
      this.lastReadAt,
      markTicketReadResponseDto.lastReadAt
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(lastReadAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class MarkTicketReadResponseDto {\n");
    sb.append("    lastReadAt: ")
      .append(toIndentedString(lastReadAt))
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
