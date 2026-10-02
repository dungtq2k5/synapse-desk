package com.synapsedesk.gateway.model;

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
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;

/**
 * AssignmentResponseDto
 */

public class AssignmentResponseDto {

  private String id;

  private String ticketId;

  private String assignedToId;

  private String assignedById;

  private String departmentId;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime assignedAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime unassignedAt = null;

  /**
   * Gets or Sets reason
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
      return null;
    }
  }

  private ReasonEnum reason = null;

  private Boolean isCurrent;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  public AssignmentResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AssignmentResponseDto(
    String id,
    String ticketId,
    String assignedToId,
    String assignedById,
    String departmentId,
    OffsetDateTime assignedAt,
    OffsetDateTime unassignedAt,
    ReasonEnum reason,
    Boolean isCurrent,
    OffsetDateTime createdAt
  ) {
    this.id = id;
    this.ticketId = ticketId;
    this.assignedToId = assignedToId;
    this.assignedById = assignedById;
    this.departmentId = departmentId;
    this.assignedAt = assignedAt;
    this.unassignedAt = unassignedAt;
    this.reason = reason;
    this.isCurrent = isCurrent;
    this.createdAt = createdAt;
  }

  public AssignmentResponseDto id(String id) {
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

  public AssignmentResponseDto ticketId(String ticketId) {
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

  public AssignmentResponseDto assignedToId(String assignedToId) {
    this.assignedToId = assignedToId;
    return this;
  }

  /**
   * Get assignedToId
   * @return assignedToId
   */
  @NotNull
  @JsonProperty("assignedToId")
  public String getAssignedToId() {
    return assignedToId;
  }

  @JsonProperty("assignedToId")
  public void setAssignedToId(String assignedToId) {
    this.assignedToId = assignedToId;
  }

  public AssignmentResponseDto assignedById(String assignedById) {
    this.assignedById = assignedById;
    return this;
  }

  /**
   * Who assigned it. Always a person.  Was `string | null`; the null had no writer — `writeAssignment` is the only one and takes an actor (known-gaps #12). Part of the pre-client clearing — see `PaginationDto`.
   * @return assignedById
   */
  @NotNull
  @JsonProperty("assignedById")
  public String getAssignedById() {
    return assignedById;
  }

  @JsonProperty("assignedById")
  public void setAssignedById(String assignedById) {
    this.assignedById = assignedById;
  }

  public AssignmentResponseDto departmentId(String departmentId) {
    this.departmentId = departmentId;
    return this;
  }

  /**
   * Get departmentId
   * @return departmentId
   */
  @NotNull
  @JsonProperty("departmentId")
  public String getDepartmentId() {
    return departmentId;
  }

  @JsonProperty("departmentId")
  public void setDepartmentId(String departmentId) {
    this.departmentId = departmentId;
  }

  public AssignmentResponseDto assignedAt(OffsetDateTime assignedAt) {
    this.assignedAt = assignedAt;
    return this;
  }

  /**
   * Get assignedAt
   * @return assignedAt
   */
  @NotNull
  @Valid
  @JsonProperty("assignedAt")
  public OffsetDateTime getAssignedAt() {
    return assignedAt;
  }

  @JsonProperty("assignedAt")
  public void setAssignedAt(OffsetDateTime assignedAt) {
    this.assignedAt = assignedAt;
  }

  public AssignmentResponseDto unassignedAt(OffsetDateTime unassignedAt) {
    this.unassignedAt = unassignedAt;
    return this;
  }

  /**
   * Get unassignedAt
   * @return unassignedAt
   */
  @Valid
  @JsonProperty("unassignedAt")
  public OffsetDateTime getUnassignedAt() {
    return unassignedAt;
  }

  @JsonProperty("unassignedAt")
  public void setUnassignedAt(OffsetDateTime unassignedAt) {
    this.unassignedAt = unassignedAt;
  }

  public AssignmentResponseDto reason(ReasonEnum reason) {
    this.reason = reason;
    return this;
  }

  /**
   * Get reason
   * @return reason
   */

  @JsonProperty("reason")
  public ReasonEnum getReason() {
    return reason;
  }

  @JsonProperty("reason")
  public void setReason(ReasonEnum reason) {
    this.reason = reason;
  }

  public AssignmentResponseDto isCurrent(Boolean isCurrent) {
    this.isCurrent = isCurrent;
    return this;
  }

  /**
   * Get isCurrent
   * @return isCurrent
   */
  @NotNull
  @JsonProperty("isCurrent")
  public Boolean getIsCurrent() {
    return isCurrent;
  }

  @JsonProperty("isCurrent")
  public void setIsCurrent(Boolean isCurrent) {
    this.isCurrent = isCurrent;
  }

  public AssignmentResponseDto createdAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  /**
   * Get createdAt
   * @return createdAt
   */
  @NotNull
  @Valid
  @JsonProperty("createdAt")
  public OffsetDateTime getCreatedAt() {
    return createdAt;
  }

  @JsonProperty("createdAt")
  public void setCreatedAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AssignmentResponseDto assignmentResponseDto = (AssignmentResponseDto) o;
    return (
      Objects.equals(this.id, assignmentResponseDto.id) &&
      Objects.equals(this.ticketId, assignmentResponseDto.ticketId) &&
      Objects.equals(this.assignedToId, assignmentResponseDto.assignedToId) &&
      Objects.equals(this.assignedById, assignmentResponseDto.assignedById) &&
      Objects.equals(this.departmentId, assignmentResponseDto.departmentId) &&
      Objects.equals(this.assignedAt, assignmentResponseDto.assignedAt) &&
      Objects.equals(this.unassignedAt, assignmentResponseDto.unassignedAt) &&
      Objects.equals(this.reason, assignmentResponseDto.reason) &&
      Objects.equals(this.isCurrent, assignmentResponseDto.isCurrent) &&
      Objects.equals(this.createdAt, assignmentResponseDto.createdAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      ticketId,
      assignedToId,
      assignedById,
      departmentId,
      assignedAt,
      unassignedAt,
      reason,
      isCurrent,
      createdAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AssignmentResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    ticketId: ").append(toIndentedString(ticketId)).append("\n");
    sb.append("    assignedToId: ")
      .append(toIndentedString(assignedToId))
      .append("\n");
    sb.append("    assignedById: ")
      .append(toIndentedString(assignedById))
      .append("\n");
    sb.append("    departmentId: ")
      .append(toIndentedString(departmentId))
      .append("\n");
    sb.append("    assignedAt: ")
      .append(toIndentedString(assignedAt))
      .append("\n");
    sb.append("    unassignedAt: ")
      .append(toIndentedString(unassignedAt))
      .append("\n");
    sb.append("    reason: ").append(toIndentedString(reason)).append("\n");
    sb.append("    isCurrent: ")
      .append(toIndentedString(isCurrent))
      .append("\n");
    sb.append("    createdAt: ")
      .append(toIndentedString(createdAt))
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
