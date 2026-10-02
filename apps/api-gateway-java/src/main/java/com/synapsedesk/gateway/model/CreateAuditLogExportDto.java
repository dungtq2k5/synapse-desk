package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * CreateAuditLogExportDto
 */

public class CreateAuditLogExportDto {

  private Map<String, Object> filters = new HashMap<>();

  private String from;

  private String to;

  public CreateAuditLogExportDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreateAuditLogExportDto(String from, String to) {
    this.from = from;
    this.to = to;
  }

  public CreateAuditLogExportDto filters(Map<String, Object> filters) {
    this.filters = filters;
    return this;
  }

  public CreateAuditLogExportDto putFiltersItem(
    String key,
    Object filtersItem
  ) {
    if (this.filters == null) {
      this.filters = new HashMap<>();
    }
    this.filters.put(key, filtersItem);
    return this;
  }

  /**
   * `action`, `resourceType`, `userId` — refused per kind at the service.
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

  public CreateAuditLogExportDto from(String from) {
    this.from = from;
    return this;
  }

  /**
   * Get from
   * @return from
   */
  @NotNull
  @JsonProperty("from")
  public String getFrom() {
    return from;
  }

  @JsonProperty("from")
  public void setFrom(String from) {
    this.from = from;
  }

  public CreateAuditLogExportDto to(String to) {
    this.to = to;
    return this;
  }

  /**
   * Get to
   * @return to
   */
  @NotNull
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
    CreateAuditLogExportDto createAuditLogExportDto =
      (CreateAuditLogExportDto) o;
    return (
      Objects.equals(this.filters, createAuditLogExportDto.filters) &&
      Objects.equals(this.from, createAuditLogExportDto.from) &&
      Objects.equals(this.to, createAuditLogExportDto.to)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(filters, from, to);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreateAuditLogExportDto {\n");
    sb.append("    filters: ").append(toIndentedString(filters)).append("\n");
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
