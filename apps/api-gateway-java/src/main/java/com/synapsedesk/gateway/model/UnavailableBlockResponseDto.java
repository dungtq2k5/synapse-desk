package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * UnavailableBlockResponseDto
 */

public class UnavailableBlockResponseDto {

  private String source;

  private String reason;

  public UnavailableBlockResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public UnavailableBlockResponseDto(String source, String reason) {
    this.source = source;
    this.reason = reason;
  }

  public UnavailableBlockResponseDto source(String source) {
    this.source = source;
    return this;
  }

  /**
   * Which leg failed, by service name.
   * @return source
   */
  @NotNull
  @JsonProperty("source")
  public String getSource() {
    return source;
  }

  @JsonProperty("source")
  public void setSource(String source) {
    this.source = source;
  }

  public UnavailableBlockResponseDto reason(String reason) {
    this.reason = reason;
    return this;
  }

  /**
   * Get reason
   * @return reason
   */
  @NotNull
  @JsonProperty("reason")
  public String getReason() {
    return reason;
  }

  @JsonProperty("reason")
  public void setReason(String reason) {
    this.reason = reason;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UnavailableBlockResponseDto unavailableBlockResponseDto =
      (UnavailableBlockResponseDto) o;
    return (
      Objects.equals(this.source, unavailableBlockResponseDto.source) &&
      Objects.equals(this.reason, unavailableBlockResponseDto.reason)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(source, reason);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UnavailableBlockResponseDto {\n");
    sb.append("    source: ").append(toIndentedString(source)).append("\n");
    sb.append("    reason: ").append(toIndentedString(reason)).append("\n");
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
