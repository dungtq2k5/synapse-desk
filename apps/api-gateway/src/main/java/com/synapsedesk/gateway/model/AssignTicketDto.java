package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * AssignTicketDto
 */

public class AssignTicketDto {

  private UUID assigneeId;

  private UUID departmentId;

  /**
   * Why it moved. Absent means the service decides from context: `INITIAL` for a first assignment, `MANUAL` for any later one.
   */
  public enum ReasonEnum {
    DEPARTMENT_CHANGE("DEPARTMENT_CHANGE"),

    ESCALATION("ESCALATION"),

    INITIAL("INITIAL"),

    LOAD_BALANCING("LOAD_BALANCING"),

    MANUAL("MANUAL"),

    SELF_ASSIGNED("SELF_ASSIGNED"),

    UNAVAILABLE("UNAVAILABLE");

    private final String value;

    ReasonEnum(String value) {
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
    public static ReasonEnum fromValue(String value) {
      for (ReasonEnum b : ReasonEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private @Nullable ReasonEnum reason;

  public AssignTicketDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AssignTicketDto(UUID assigneeId, UUID departmentId) {
    this.assigneeId = assigneeId;
    this.departmentId = departmentId;
  }

  public AssignTicketDto assigneeId(UUID assigneeId) {
    this.assigneeId = assigneeId;
    return this;
  }

  /**
   * Get assigneeId
   * @return assigneeId
   */
  @NotNull
  @Valid
  @JsonProperty("assigneeId")
  public UUID getAssigneeId() {
    return assigneeId;
  }

  @JsonProperty("assigneeId")
  public void setAssigneeId(UUID assigneeId) {
    this.assigneeId = assigneeId;
  }

  public AssignTicketDto departmentId(UUID departmentId) {
    this.departmentId = departmentId;
    return this;
  }

  /**
   * Required, not inferred from the assignee's primary department.  Inferring it would put the ticket wherever that agent happens to sit, which is wrong the moment someone belongs to two teams — and it would make the queue a ticket lands in depend on a fact about a PERSON rather than a decision about the WORK. Both ids are validated against auth-service before anything is written.
   * @return departmentId
   */
  @NotNull
  @Valid
  @JsonProperty("departmentId")
  public UUID getDepartmentId() {
    return departmentId;
  }

  @JsonProperty("departmentId")
  public void setDepartmentId(UUID departmentId) {
    this.departmentId = departmentId;
  }

  public AssignTicketDto reason(@Nullable ReasonEnum reason) {
    this.reason = reason;
    return this;
  }

  /**
   * Why it moved. Absent means the service decides from context: `INITIAL` for a first assignment, `MANUAL` for any later one.
   * @return reason
   */

  @JsonProperty("reason")
  public @Nullable ReasonEnum getReason() {
    return reason;
  }

  @JsonProperty("reason")
  public void setReason(@Nullable ReasonEnum reason) {
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
    AssignTicketDto assignTicketDto = (AssignTicketDto) o;
    return (
      Objects.equals(this.assigneeId, assignTicketDto.assigneeId) &&
      Objects.equals(this.departmentId, assignTicketDto.departmentId) &&
      Objects.equals(this.reason, assignTicketDto.reason)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(assigneeId, departmentId, reason);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AssignTicketDto {\n");
    sb.append("    assigneeId: ")
      .append(toIndentedString(assigneeId))
      .append("\n");
    sb.append("    departmentId: ")
      .append(toIndentedString(departmentId))
      .append("\n");
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
