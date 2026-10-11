package com.synapsedesk.gateway.modules.tickets.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * BulkTicketStatusDto
 */

public class BulkTicketStatusDto {

  private List<UUID> ticketIds = new ArrayList<>();

  /**
   * Gets or Sets status
   */
  public enum StatusEnum {
    CLOSED("CLOSED"),

    ESCALATED("ESCALATED"),

    NEW("NEW"),

    OPEN("OPEN"),

    PENDING_AGENT("PENDING_AGENT"),

    RESOLVED("RESOLVED");

    private final String value;

    StatusEnum(String value) {
      this.value = value;
    }

    @JsonValue
    public String getValue() {
      return value;
    }

    @Override
    public String toString() {
      return String.valueOf(value);
    }

    @JsonCreator
    public static StatusEnum fromValue(String value) {
      for (StatusEnum b : StatusEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private StatusEnum status;

  private @Nullable String reason;

  public BulkTicketStatusDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public BulkTicketStatusDto(List<UUID> ticketIds, StatusEnum status) {
    this.ticketIds = ticketIds;
    this.status = status;
  }

  public BulkTicketStatusDto ticketIds(List<UUID> ticketIds) {
    this.ticketIds = ticketIds;
    return this;
  }

  public BulkTicketStatusDto addTicketIdsItem(UUID ticketIdsItem) {
    if (this.ticketIds == null) {
      this.ticketIds = new ArrayList<>();
    }
    this.ticketIds.add(ticketIdsItem);
    return this;
  }

  /**
   * Get ticketIds
   * @return ticketIds
   */
  @NotNull
  @Valid
  @Size(min = 1)
  @JsonProperty("ticketIds")
  public List<UUID> getTicketIds() {
    return ticketIds;
  }

  @JsonProperty("ticketIds")
  public void setTicketIds(List<UUID> ticketIds) {
    this.ticketIds = ticketIds;
  }

  public BulkTicketStatusDto status(StatusEnum status) {
    this.status = status;
    return this;
  }

  /**
   * Get status
   * @return status
   */
  @NotNull
  @JsonProperty("status")
  public StatusEnum getStatus() {
    return status;
  }

  @JsonProperty("status")
  public void setStatus(StatusEnum status) {
    this.status = status;
  }

  public BulkTicketStatusDto reason(@Nullable String reason) {
    this.reason = reason;
    return this;
  }

  /**
   * Get reason
   * @return reason
   */
  @Size(max = 500)
  @JsonProperty("reason")
  public @Nullable String getReason() {
    return reason;
  }

  @JsonProperty("reason")
  public void setReason(@Nullable String reason) {
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
    BulkTicketStatusDto bulkTicketStatusDto = (BulkTicketStatusDto) o;
    return (
      Objects.equals(this.ticketIds, bulkTicketStatusDto.ticketIds) &&
      Objects.equals(this.status, bulkTicketStatusDto.status) &&
      Objects.equals(this.reason, bulkTicketStatusDto.reason)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(ticketIds, status, reason);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class BulkTicketStatusDto {\n");
    sb.append("    ticketIds: ")
      .append(toIndentedString(ticketIds))
      .append("\n");
    sb.append("    status: ").append(toIndentedString(status)).append("\n");
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
