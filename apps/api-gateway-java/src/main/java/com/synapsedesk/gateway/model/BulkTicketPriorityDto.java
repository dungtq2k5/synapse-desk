package com.synapsedesk.gateway.model;

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
 * BulkTicketPriorityDto
 */

public class BulkTicketPriorityDto {

  private List<UUID> ticketIds = new ArrayList<>();

  /**
   * Gets or Sets priority
   */
  public enum PriorityEnum {
    HIGH("HIGH"),

    LOW("LOW"),

    MEDIUM("MEDIUM"),

    URGENT("URGENT");

    private final String value;

    PriorityEnum(String value) {
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
    public static PriorityEnum fromValue(String value) {
      for (PriorityEnum b : PriorityEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private PriorityEnum priority;

  public BulkTicketPriorityDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public BulkTicketPriorityDto(List<UUID> ticketIds, PriorityEnum priority) {
    this.ticketIds = ticketIds;
    this.priority = priority;
  }

  public BulkTicketPriorityDto ticketIds(List<UUID> ticketIds) {
    this.ticketIds = ticketIds;
    return this;
  }

  public BulkTicketPriorityDto addTicketIdsItem(UUID ticketIdsItem) {
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

  public BulkTicketPriorityDto priority(PriorityEnum priority) {
    this.priority = priority;
    return this;
  }

  /**
   * Get priority
   * @return priority
   */
  @NotNull
  @JsonProperty("priority")
  public PriorityEnum getPriority() {
    return priority;
  }

  @JsonProperty("priority")
  public void setPriority(PriorityEnum priority) {
    this.priority = priority;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    BulkTicketPriorityDto bulkTicketPriorityDto = (BulkTicketPriorityDto) o;
    return (
      Objects.equals(this.ticketIds, bulkTicketPriorityDto.ticketIds) &&
      Objects.equals(this.priority, bulkTicketPriorityDto.priority)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(ticketIds, priority);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class BulkTicketPriorityDto {\n");
    sb.append("    ticketIds: ")
      .append(toIndentedString(ticketIds))
      .append("\n");
    sb.append("    priority: ").append(toIndentedString(priority)).append("\n");
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
