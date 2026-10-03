package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.validation.StrictIso8601;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.lang.Nullable;

/**
 * CreateTicketExportDto
 */

public class CreateTicketExportDto {

  private Map<String, Object> filters = new HashMap<>();

  private String from;

  private String to;

  private @Nullable UUID departmentId;

  public CreateTicketExportDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreateTicketExportDto(String from, String to) {
    this.from = from;
    this.to = to;
  }

  public CreateTicketExportDto filters(Map<String, Object> filters) {
    this.filters = filters;
    return this;
  }

  public CreateTicketExportDto putFiltersItem(String key, Object filtersItem) {
    if (this.filters == null) {
      this.filters = new HashMap<>();
    }
    this.filters.put(key, filtersItem);
    return this;
  }

  /**
   * `status`, `priority`, `assigneeId` — refused per kind at the service.
   * @return filters
   */

  @JsonProperty("filters")
  public Map<String, Object> getFilters() {
    return filters;
  }

  @JsonProperty("filters")
  public void setFilters(Map<String, Object> filters) {
    this.filters = filters;
  }

  public CreateTicketExportDto from(String from) {
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

  public CreateTicketExportDto to(String to) {
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

  public CreateTicketExportDto departmentId(@Nullable UUID departmentId) {
    this.departmentId = departmentId;
    return this;
  }

  /**
   * Get departmentId
   * @return departmentId
   */
  @Valid
  @JsonProperty("departmentId")
  public @Nullable UUID getDepartmentId() {
    return departmentId;
  }

  @JsonProperty("departmentId")
  public void setDepartmentId(@Nullable UUID departmentId) {
    this.departmentId = departmentId;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    CreateTicketExportDto createTicketExportDto = (CreateTicketExportDto) o;
    return (
      Objects.equals(this.filters, createTicketExportDto.filters) &&
      Objects.equals(this.from, createTicketExportDto.from) &&
      Objects.equals(this.to, createTicketExportDto.to) &&
      Objects.equals(this.departmentId, createTicketExportDto.departmentId)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(filters, from, to, departmentId);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreateTicketExportDto {\n");
    sb.append("    filters: ").append(toIndentedString(filters)).append("\n");
    sb.append("    from: ").append(toIndentedString(from)).append("\n");
    sb.append("    to: ").append(toIndentedString(to)).append("\n");
    sb.append("    departmentId: ")
      .append(toIndentedString(departmentId))
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
