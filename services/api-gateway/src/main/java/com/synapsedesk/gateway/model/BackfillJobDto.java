package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.common.validation.StrictIso8601;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * BackfillJobDto
 */

public class BackfillJobDto {

  private String reason;

  private String from;

  private String to;

  public BackfillJobDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public BackfillJobDto(String reason, String from, String to) {
    this.reason = reason;
    this.from = from;
    this.to = to;
  }

  public BackfillJobDto reason(String reason) {
    this.reason = reason;
    return this;
  }

  /**
   * **Mandatory.** A backfill rewrites numbers somebody may already have acted on, and \"why\" is the only part of that a reader cannot reconstruct afterwards from the rows themselves.
   * @return reason
   */
  @NotNull
  @Size(min = 1, max = 500)
  @JsonProperty("reason")
  public String getReason() {
    return reason;
  }

  @JsonProperty("reason")
  public void setReason(String reason) {
    this.reason = reason;
  }

  public BackfillJobDto from(String from) {
    this.from = from;
    return this;
  }

  /**
   * Get from
   * @return from
   */
  @NotNull
  @StrictIso8601
  @JsonProperty("from")
  public String getFrom() {
    return from;
  }

  @JsonProperty("from")
  public void setFrom(String from) {
    this.from = from;
  }

  public BackfillJobDto to(String to) {
    this.to = to;
    return this;
  }

  /**
   * Get to
   * @return to
   */
  @NotNull
  @StrictIso8601
  @JsonProperty("to")
  public String getTo() {
    return to;
  }

  @JsonProperty("to")
  public void setTo(String to) {
    this.to = to;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    BackfillJobDto backfillJobDto = (BackfillJobDto) o;
    return (
      Objects.equals(this.reason, backfillJobDto.reason) &&
      Objects.equals(this.from, backfillJobDto.from) &&
      Objects.equals(this.to, backfillJobDto.to)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(reason, from, to);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class BackfillJobDto {\n");
    sb.append("    reason: ").append(toIndentedString(reason)).append("\n");
    sb.append("    from: ").append(toIndentedString(from)).append("\n");
    sb.append("    to: ").append(toIndentedString(to)).append("\n");
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
