package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import com.synapsedesk.gateway.common.validation.StrictIso8601;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * CreateExportDto
 */

public class CreateExportDto {

  private Map<String, Object> filters = new HashMap<>();

  /**
   * Gets or Sets kind
   */
  public enum KindEnum {
    AGENT_DAILY("AGENT_DAILY"),

    AUDIT_LOG("AUDIT_LOG"),

    TICKET("TICKET"),

    TICKET_DAILY("TICKET_DAILY");

    private final String value;

    KindEnum(String value) {
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
    public static KindEnum fromValue(String value) {
      for (KindEnum b : KindEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private KindEnum kind;

  private String from;

  private String to;

  private @Nullable UUID departmentId;

  public CreateExportDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreateExportDto(KindEnum kind, String from, String to) {
    this.kind = kind;
    this.from = from;
    this.to = to;
  }

  public CreateExportDto filters(Map<String, Object> filters) {
    this.filters = filters;
    return this;
  }

  public CreateExportDto putFiltersItem(String key, Object filtersItem) {
    if (this.filters == null) {
      this.filters = new HashMap<>();
    }
    this.filters.put(key, filtersItem);
    return this;
  }

  /**
   * Per-kind predicates the three kinds do not share.  Validated at the SERVICE against `EXPORT_FILTER_KEYS`, not here: the allowed keys differ per kind, and a DTO cannot see which kind it carries without splitting into three. An unknown key is refused rather than stored and ignored — a filter the caller believes applied and that silently did not is the failure this shape is most exposed to.
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

  public CreateExportDto kind(KindEnum kind) {
    this.kind = kind;
    return this;
  }

  /**
   * Get kind
   * @return kind
   */
  @NotNull
  @JsonProperty("kind")
  public KindEnum getKind() {
    return kind;
  }

  @JsonProperty("kind")
  public void setKind(KindEnum kind) {
    this.kind = kind;
  }

  public CreateExportDto from(String from) {
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

  public CreateExportDto to(String to) {
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

  public CreateExportDto departmentId(@Nullable UUID departmentId) {
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
    CreateExportDto createExportDto = (CreateExportDto) o;
    return (
      Objects.equals(this.filters, createExportDto.filters) &&
      Objects.equals(this.kind, createExportDto.kind) &&
      Objects.equals(this.from, createExportDto.from) &&
      Objects.equals(this.to, createExportDto.to) &&
      Objects.equals(this.departmentId, createExportDto.departmentId)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(filters, kind, from, to, departmentId);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreateExportDto {\n");
    sb.append("    filters: ").append(toIndentedString(filters)).append("\n");
    sb.append("    kind: ").append(toIndentedString(kind)).append("\n");
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
