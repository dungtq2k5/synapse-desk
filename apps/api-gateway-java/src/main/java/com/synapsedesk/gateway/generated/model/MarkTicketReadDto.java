package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.time.OffsetDateTime;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * MarkTicketReadDto
 */

public class MarkTicketReadDto {

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private @Nullable OffsetDateTime readAt;

  public MarkTicketReadDto readAt(@Nullable OffsetDateTime readAt) {
    this.readAt = readAt;
    return this;
  }

  /**
   * Get readAt
   * @return readAt
   */
  @Valid 
  @JsonProperty("readAt")
  public @Nullable OffsetDateTime getReadAt() {
    return readAt;
  }

  @JsonProperty("readAt")
  public void setReadAt(@Nullable OffsetDateTime readAt) {
    this.readAt = readAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    MarkTicketReadDto markTicketReadDto = (MarkTicketReadDto) o;
    return Objects.equals(this.readAt, markTicketReadDto.readAt);
  }

  @Override
  public int hashCode() {
    return Objects.hash(readAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class MarkTicketReadDto {\n");
    sb.append("    readAt: ").append(toIndentedString(readAt)).append("\n");
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

