package com.synapsedesk.gateway.modules.tickets.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import com.synapsedesk.gateway.common.dto.DepartmentReferenceResponseDto;
import com.synapsedesk.gateway.common.dto.UserReferenceResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * TicketResponseDto
 */

public class TicketResponseDto {

  private String id;

  private BigDecimal ticketNumber;

  private String organizationId;

  private String authorId;

  /**
   * Gets or Sets source
   */
  public enum SourceEnum {
    API("API"),

    CHAT("CHAT"),

    EMAIL("EMAIL"),

    WEB("WEB");

    private final String value;

    SourceEnum(String value) {
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
    public static SourceEnum fromValue(String value) {
      for (SourceEnum b : SourceEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private SourceEnum source = null;

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
      return null;
    }
  }

  private StatusEnum status = null;

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
      return null;
    }
  }

  private PriorityEnum priority = null;

  private String title;

  private String description;

  private String currentAssigneeId = null;

  private String currentDepartmentId = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime escalatedAt = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime resolvedAt = null;

  private BigDecimal unreadCount;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime updatedAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime deletedAt = null;

  private String deletedById = null;

  private List<@Valid AttachmentResponseDto> attachments = new ArrayList<>();

  private UserReferenceResponseDto author = null;

  private UserReferenceResponseDto assignee = null;

  private DepartmentReferenceResponseDto department = null;

  public TicketResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public TicketResponseDto(
    String id,
    BigDecimal ticketNumber,
    String organizationId,
    String authorId,
    SourceEnum source,
    StatusEnum status,
    PriorityEnum priority,
    String title,
    String description,
    String currentAssigneeId,
    String currentDepartmentId,
    OffsetDateTime escalatedAt,
    OffsetDateTime resolvedAt,
    BigDecimal unreadCount,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt,
    OffsetDateTime deletedAt,
    String deletedById
  ) {
    this.id = id;
    this.ticketNumber = ticketNumber;
    this.organizationId = organizationId;
    this.authorId = authorId;
    this.source = source;
    this.status = status;
    this.priority = priority;
    this.title = title;
    this.description = description;
    this.currentAssigneeId = currentAssigneeId;
    this.currentDepartmentId = currentDepartmentId;
    this.escalatedAt = escalatedAt;
    this.resolvedAt = resolvedAt;
    this.unreadCount = unreadCount;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.deletedAt = deletedAt;
    this.deletedById = deletedById;
  }

  public TicketResponseDto id(String id) {
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

  public TicketResponseDto ticketNumber(BigDecimal ticketNumber) {
    this.ticketNumber = ticketNumber;
    return this;
  }

  /**
   * A number, not a string: `longs: Number` keeps int64 exact to 2^53.
   * @return ticketNumber
   */
  @NotNull
  @Valid
  @JsonProperty("ticketNumber")
  public BigDecimal getTicketNumber() {
    return ticketNumber;
  }

  @JsonProperty("ticketNumber")
  public void setTicketNumber(BigDecimal ticketNumber) {
    this.ticketNumber = ticketNumber;
  }

  public TicketResponseDto organizationId(String organizationId) {
    this.organizationId = organizationId;
    return this;
  }

  /**
   * Get organizationId
   * @return organizationId
   */
  @NotNull
  @JsonProperty("organizationId")
  public String getOrganizationId() {
    return organizationId;
  }

  @JsonProperty("organizationId")
  public void setOrganizationId(String organizationId) {
    this.organizationId = organizationId;
  }

  public TicketResponseDto authorId(String authorId) {
    this.authorId = authorId;
    return this;
  }

  /**
   * Get authorId
   * @return authorId
   */
  @NotNull
  @JsonProperty("authorId")
  public String getAuthorId() {
    return authorId;
  }

  @JsonProperty("authorId")
  public void setAuthorId(String authorId) {
    this.authorId = authorId;
  }

  public TicketResponseDto source(SourceEnum source) {
    this.source = source;
    return this;
  }

  /**
   * Get source
   * @return source
   */

  @JsonProperty("source")
  public SourceEnum getSource() {
    return source;
  }

  @JsonProperty("source")
  public void setSource(SourceEnum source) {
    this.source = source;
  }

  public TicketResponseDto status(StatusEnum status) {
    this.status = status;
    return this;
  }

  /**
   * Get status
   * @return status
   */

  @JsonProperty("status")
  public StatusEnum getStatus() {
    return status;
  }

  @JsonProperty("status")
  public void setStatus(StatusEnum status) {
    this.status = status;
  }

  public TicketResponseDto priority(PriorityEnum priority) {
    this.priority = priority;
    return this;
  }

  /**
   * Get priority
   * @return priority
   */

  @JsonProperty("priority")
  public PriorityEnum getPriority() {
    return priority;
  }

  @JsonProperty("priority")
  public void setPriority(PriorityEnum priority) {
    this.priority = priority;
  }

  public TicketResponseDto title(String title) {
    this.title = title;
    return this;
  }

  /**
   * Get title
   * @return title
   */
  @NotNull
  @JsonProperty("title")
  public String getTitle() {
    return title;
  }

  @JsonProperty("title")
  public void setTitle(String title) {
    this.title = title;
  }

  public TicketResponseDto description(String description) {
    this.description = description;
    return this;
  }

  /**
   * Get description
   * @return description
   */
  @NotNull
  @JsonProperty("description")
  public String getDescription() {
    return description;
  }

  @JsonProperty("description")
  public void setDescription(String description) {
    this.description = description;
  }

  public TicketResponseDto currentAssigneeId(String currentAssigneeId) {
    this.currentAssigneeId = currentAssigneeId;
    return this;
  }

  /**
   * Get currentAssigneeId
   * @return currentAssigneeId
   */

  @JsonProperty("currentAssigneeId")
  public String getCurrentAssigneeId() {
    return currentAssigneeId;
  }

  @JsonProperty("currentAssigneeId")
  public void setCurrentAssigneeId(String currentAssigneeId) {
    this.currentAssigneeId = currentAssigneeId;
  }

  public TicketResponseDto currentDepartmentId(String currentDepartmentId) {
    this.currentDepartmentId = currentDepartmentId;
    return this;
  }

  /**
   * Get currentDepartmentId
   * @return currentDepartmentId
   */

  @JsonProperty("currentDepartmentId")
  public String getCurrentDepartmentId() {
    return currentDepartmentId;
  }

  @JsonProperty("currentDepartmentId")
  public void setCurrentDepartmentId(String currentDepartmentId) {
    this.currentDepartmentId = currentDepartmentId;
  }

  public TicketResponseDto escalatedAt(OffsetDateTime escalatedAt) {
    this.escalatedAt = escalatedAt;
    return this;
  }

  /**
   * Get escalatedAt
   * @return escalatedAt
   */
  @Valid
  @JsonProperty("escalatedAt")
  public OffsetDateTime getEscalatedAt() {
    return escalatedAt;
  }

  @JsonProperty("escalatedAt")
  public void setEscalatedAt(OffsetDateTime escalatedAt) {
    this.escalatedAt = escalatedAt;
  }

  public TicketResponseDto resolvedAt(OffsetDateTime resolvedAt) {
    this.resolvedAt = resolvedAt;
    return this;
  }

  /**
   * Get resolvedAt
   * @return resolvedAt
   */
  @Valid
  @JsonProperty("resolvedAt")
  public OffsetDateTime getResolvedAt() {
    return resolvedAt;
  }

  @JsonProperty("resolvedAt")
  public void setResolvedAt(OffsetDateTime resolvedAt) {
    this.resolvedAt = resolvedAt;
  }

  public TicketResponseDto unreadCount(BigDecimal unreadCount) {
    this.unreadCount = unreadCount;
    return this;
  }

  /**
   * Messages the caller has not read on this ticket.  Excludes their own and any internal note they cannot see. A ticket never opened counts as ALL unread, not zero. Always `0` on a single-ticket read — a badge is a list affordance, and a caller looking at one ticket is reading it.
   * @return unreadCount
   */
  @NotNull
  @Valid
  @JsonProperty("unreadCount")
  public BigDecimal getUnreadCount() {
    return unreadCount;
  }

  @JsonProperty("unreadCount")
  public void setUnreadCount(BigDecimal unreadCount) {
    this.unreadCount = unreadCount;
  }

  public TicketResponseDto createdAt(OffsetDateTime createdAt) {
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

  public TicketResponseDto updatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
    return this;
  }

  /**
   * Get updatedAt
   * @return updatedAt
   */
  @NotNull
  @Valid
  @JsonProperty("updatedAt")
  public OffsetDateTime getUpdatedAt() {
    return updatedAt;
  }

  @JsonProperty("updatedAt")
  public void setUpdatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
  }

  public TicketResponseDto deletedAt(OffsetDateTime deletedAt) {
    this.deletedAt = deletedAt;
    return this;
  }

  /**
   * Get deletedAt
   * @return deletedAt
   */
  @Valid
  @JsonProperty("deletedAt")
  public OffsetDateTime getDeletedAt() {
    return deletedAt;
  }

  @JsonProperty("deletedAt")
  public void setDeletedAt(OffsetDateTime deletedAt) {
    this.deletedAt = deletedAt;
  }

  public TicketResponseDto deletedById(String deletedById) {
    this.deletedById = deletedById;
    return this;
  }

  /**
   * Get deletedById
   * @return deletedById
   */

  @JsonProperty("deletedById")
  public String getDeletedById() {
    return deletedById;
  }

  @JsonProperty("deletedById")
  public void setDeletedById(String deletedById) {
    this.deletedById = deletedById;
  }

  public TicketResponseDto attachments(
    List<@Valid AttachmentResponseDto> attachments
  ) {
    this.attachments = attachments;
    return this;
  }

  /**
   * The files uploaded with the ticket's opening (the description); empty when
   * none. A message's files are on the message.
   * @return attachments
   */
  @NotNull
  @Valid
  @JsonProperty("attachments")
  public List<@Valid AttachmentResponseDto> getAttachments() {
    return attachments;
  }

  @JsonProperty("attachments")
  public void setAttachments(List<@Valid AttachmentResponseDto> attachments) {
    this.attachments = attachments;
  }

  public TicketResponseDto author(UserReferenceResponseDto author) {
    this.author = author;
    return this;
  }

  @JsonProperty("author")
  public UserReferenceResponseDto getAuthor() {
    return author;
  }

  @JsonProperty("author")
  public void setAuthor(UserReferenceResponseDto author) {
    this.author = author;
  }

  public TicketResponseDto assignee(UserReferenceResponseDto assignee) {
    this.assignee = assignee;
    return this;
  }

  @JsonProperty("assignee")
  public UserReferenceResponseDto getAssignee() {
    return assignee;
  }

  @JsonProperty("assignee")
  public void setAssignee(UserReferenceResponseDto assignee) {
    this.assignee = assignee;
  }

  public TicketResponseDto department(
    DepartmentReferenceResponseDto department
  ) {
    this.department = department;
    return this;
  }

  @JsonProperty("department")
  public DepartmentReferenceResponseDto getDepartment() {
    return department;
  }

  @JsonProperty("department")
  public void setDepartment(DepartmentReferenceResponseDto department) {
    this.department = department;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    TicketResponseDto ticketResponseDto = (TicketResponseDto) o;
    return (
      Objects.equals(this.id, ticketResponseDto.id) &&
      Objects.equals(this.ticketNumber, ticketResponseDto.ticketNumber) &&
      Objects.equals(this.organizationId, ticketResponseDto.organizationId) &&
      Objects.equals(this.authorId, ticketResponseDto.authorId) &&
      Objects.equals(this.source, ticketResponseDto.source) &&
      Objects.equals(this.status, ticketResponseDto.status) &&
      Objects.equals(this.priority, ticketResponseDto.priority) &&
      Objects.equals(this.title, ticketResponseDto.title) &&
      Objects.equals(this.description, ticketResponseDto.description) &&
      Objects.equals(
        this.currentAssigneeId,
        ticketResponseDto.currentAssigneeId
      ) &&
      Objects.equals(
        this.currentDepartmentId,
        ticketResponseDto.currentDepartmentId
      ) &&
      Objects.equals(this.escalatedAt, ticketResponseDto.escalatedAt) &&
      Objects.equals(this.resolvedAt, ticketResponseDto.resolvedAt) &&
      Objects.equals(this.unreadCount, ticketResponseDto.unreadCount) &&
      Objects.equals(this.createdAt, ticketResponseDto.createdAt) &&
      Objects.equals(this.updatedAt, ticketResponseDto.updatedAt) &&
      Objects.equals(this.deletedAt, ticketResponseDto.deletedAt) &&
      Objects.equals(this.deletedById, ticketResponseDto.deletedById) &&
      Objects.equals(this.attachments, ticketResponseDto.attachments)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      ticketNumber,
      organizationId,
      authorId,
      source,
      status,
      priority,
      title,
      description,
      currentAssigneeId,
      currentDepartmentId,
      escalatedAt,
      resolvedAt,
      unreadCount,
      createdAt,
      updatedAt,
      deletedAt,
      deletedById,
      attachments
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class TicketResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    ticketNumber: ")
      .append(toIndentedString(ticketNumber))
      .append("\n");
    sb.append("    organizationId: ")
      .append(toIndentedString(organizationId))
      .append("\n");
    sb.append("    authorId: ").append(toIndentedString(authorId)).append("\n");
    sb.append("    source: ").append(toIndentedString(source)).append("\n");
    sb.append("    status: ").append(toIndentedString(status)).append("\n");
    sb.append("    priority: ").append(toIndentedString(priority)).append("\n");
    sb.append("    title: ").append(toIndentedString(title)).append("\n");
    sb.append("    description: ")
      .append(toIndentedString(description))
      .append("\n");
    sb.append("    currentAssigneeId: ")
      .append(toIndentedString(currentAssigneeId))
      .append("\n");
    sb.append("    currentDepartmentId: ")
      .append(toIndentedString(currentDepartmentId))
      .append("\n");
    sb.append("    escalatedAt: ")
      .append(toIndentedString(escalatedAt))
      .append("\n");
    sb.append("    resolvedAt: ")
      .append(toIndentedString(resolvedAt))
      .append("\n");
    sb.append("    unreadCount: ")
      .append(toIndentedString(unreadCount))
      .append("\n");
    sb.append("    createdAt: ")
      .append(toIndentedString(createdAt))
      .append("\n");
    sb.append("    updatedAt: ")
      .append(toIndentedString(updatedAt))
      .append("\n");
    sb.append("    deletedAt: ")
      .append(toIndentedString(deletedAt))
      .append("\n");
    sb.append("    deletedById: ")
      .append(toIndentedString(deletedById))
      .append("\n");
    sb.append("    attachments: ")
      .append(toIndentedString(attachments))
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
