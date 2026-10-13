package com.synapsedesk.gateway.modules.tickets.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * BulkTicketFailureResponseDto
 */

public class BulkTicketFailureResponseDto {

  private String id;

  private String reason;

  public BulkTicketFailureResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public BulkTicketFailureResponseDto(String id, String reason) {
    this.id = id;
    this.reason = reason;
  }

  public BulkTicketFailureResponseDto id(String id) {
    this.id = id;
    return this;
  }

  /**
   * Get id
   * @return id
   */
  @NotNull
  @JsonProperty("id")
  public String getId() {
    return id;
  }

  @JsonProperty("id")
  public void setId(String id) {
    this.id = id;
  }

  public BulkTicketFailureResponseDto reason(String reason) {
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
    BulkTicketFailureResponseDto bulkTicketFailureResponseDto =
      (BulkTicketFailureResponseDto) o;
    return (
      Objects.equals(this.id, bulkTicketFailureResponseDto.id) &&
      Objects.equals(this.reason, bulkTicketFailureResponseDto.reason)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, reason);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class BulkTicketFailureResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
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
