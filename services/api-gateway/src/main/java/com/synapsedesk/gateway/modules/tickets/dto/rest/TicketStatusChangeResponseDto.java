package com.synapsedesk.gateway.modules.tickets.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
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
 * TicketStatusChangeResponseDto
 */

public class TicketStatusChangeResponseDto {

  private String id;

  private String ticketId;

  /**
   * Null on a row with no prior status.
   */
  public enum FromStatusEnum {
    CLOSED("CLOSED"),

    ESCALATED("ESCALATED"),

    NEW("NEW"),

    OPEN("OPEN"),

    PENDING_AGENT("PENDING_AGENT"),

    RESOLVED("RESOLVED");

    private final String value;

    FromStatusEnum(String value) {
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
    public static FromStatusEnum fromValue(String value) {
      for (FromStatusEnum b : FromStatusEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private FromStatusEnum fromStatus = null;

  /**
   * Gets or Sets toStatus
   */
  public enum ToStatusEnum {
    CLOSED("CLOSED"),

    ESCALATED("ESCALATED"),

    NEW("NEW"),

    OPEN("OPEN"),

    PENDING_AGENT("PENDING_AGENT"),

    RESOLVED("RESOLVED");

    private final String value;

    ToStatusEnum(String value) {
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
    public static ToStatusEnum fromValue(String value) {
      for (ToStatusEnum b : ToStatusEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private ToStatusEnum toStatus;

  private String changedById;

  private String reason = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime changedAt;

  public TicketStatusChangeResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public TicketStatusChangeResponseDto(
    String id,
    String ticketId,
    FromStatusEnum fromStatus,
    ToStatusEnum toStatus,
    String changedById,
    String reason,
    OffsetDateTime changedAt
  ) {
    this.id = id;
    this.ticketId = ticketId;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
    this.changedById = changedById;
    this.reason = reason;
    this.changedAt = changedAt;
  }

  public TicketStatusChangeResponseDto id(String id) {
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

  public TicketStatusChangeResponseDto ticketId(String ticketId) {
    this.ticketId = ticketId;
    return this;
  }

  /**
   * Get ticketId
   * @return ticketId
   */
  @NotNull
  @JsonProperty("ticketId")
  public String getTicketId() {
    return ticketId;
  }

  @JsonProperty("ticketId")
  public void setTicketId(String ticketId) {
    this.ticketId = ticketId;
  }

  public TicketStatusChangeResponseDto fromStatus(FromStatusEnum fromStatus) {
    this.fromStatus = fromStatus;
    return this;
  }

  /**
   * Null on a row with no prior status.
   * @return fromStatus
   */

  @JsonProperty("fromStatus")
  public FromStatusEnum getFromStatus() {
    return fromStatus;
  }

  @JsonProperty("fromStatus")
  public void setFromStatus(FromStatusEnum fromStatus) {
    this.fromStatus = fromStatus;
  }

  public TicketStatusChangeResponseDto toStatus(ToStatusEnum toStatus) {
    this.toStatus = toStatus;
    return this;
  }

  /**
   * Get toStatus
   * @return toStatus
   */
  @NotNull
  @JsonProperty("toStatus")
  public ToStatusEnum getToStatus() {
    return toStatus;
  }

  @JsonProperty("toStatus")
  public void setToStatus(ToStatusEnum toStatus) {
    this.toStatus = toStatus;
  }

  public TicketStatusChangeResponseDto changedById(String changedById) {
    this.changedById = changedById;
    return this;
  }

  /**
   * Get changedById
   * @return changedById
   */
  @NotNull
  @JsonProperty("changedById")
  public String getChangedById() {
    return changedById;
  }

  @JsonProperty("changedById")
  public void setChangedById(String changedById) {
    this.changedById = changedById;
  }

  public TicketStatusChangeResponseDto reason(String reason) {
    this.reason = reason;
    return this;
  }

  /**
   * Null when the caller may not read it — see the route's docblock.
   * @return reason
   */

  @JsonProperty("reason")
  public String getReason() {
    return reason;
  }

  @JsonProperty("reason")
  public void setReason(String reason) {
    this.reason = reason;
  }

  public TicketStatusChangeResponseDto changedAt(OffsetDateTime changedAt) {
    this.changedAt = changedAt;
    return this;
  }

  /**
   * Get changedAt
   * @return changedAt
   */
  @NotNull
  @Valid
  @JsonProperty("changedAt")
  public OffsetDateTime getChangedAt() {
    return changedAt;
  }

  @JsonProperty("changedAt")
  public void setChangedAt(OffsetDateTime changedAt) {
    this.changedAt = changedAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    TicketStatusChangeResponseDto ticketStatusChangeResponseDto =
      (TicketStatusChangeResponseDto) o;
    return (
      Objects.equals(this.id, ticketStatusChangeResponseDto.id) &&
      Objects.equals(this.ticketId, ticketStatusChangeResponseDto.ticketId) &&
      Objects.equals(
        this.fromStatus,
        ticketStatusChangeResponseDto.fromStatus
      ) &&
      Objects.equals(this.toStatus, ticketStatusChangeResponseDto.toStatus) &&
      Objects.equals(
        this.changedById,
        ticketStatusChangeResponseDto.changedById
      ) &&
      Objects.equals(this.reason, ticketStatusChangeResponseDto.reason) &&
      Objects.equals(this.changedAt, ticketStatusChangeResponseDto.changedAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      ticketId,
      fromStatus,
      toStatus,
      changedById,
      reason,
      changedAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class TicketStatusChangeResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    ticketId: ").append(toIndentedString(ticketId)).append("\n");
    sb.append("    fromStatus: ")
      .append(toIndentedString(fromStatus))
      .append("\n");
    sb.append("    toStatus: ").append(toIndentedString(toStatus)).append("\n");
    sb.append("    changedById: ")
      .append(toIndentedString(changedById))
      .append("\n");
    sb.append("    reason: ").append(toIndentedString(reason)).append("\n");
    sb.append("    changedAt: ")
      .append(toIndentedString(changedAt))
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
