package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * NotificationResponseDto
 */

public class NotificationResponseDto {

  private String id;

  private String organizationId;

  /**
   * The ORIGINATING event — `ticket.assigned`, never the NATS subject.  `null` for a type this build does not recognise.
   */
  public enum TypeEnum {
    BILLING_PAYMENT_FAILED("billing.payment_failed"),

    BILLING_PLAN_CHANGED("billing.plan_changed"),

    LIMIT_THRESHOLD("limit.threshold"),

    QUOTA_THRESHOLD("quota.threshold"),

    TICKET_ASSIGNED("ticket.assigned"),

    TICKET_ESCALATED("ticket.escalated"),

    TICKET_MESSAGE_CREATED("ticket.message_created"),

    TICKET_REASSIGNED("ticket.reassigned"),

    TICKET_STATUS_CHANGED("ticket.status_changed"),

    WEBHOOK_ENDPOINT_DISABLED("webhook.endpoint_disabled");

    private final String value;

    TypeEnum(String value) {
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
    public static TypeEnum fromValue(String value) {
      for (TypeEnum b : TypeEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private TypeEnum type = null;

  /**
   * How urgent it is. `null` when the wire value is one this build cannot name.
   */
  public enum PriorityEnum {
    CRITICAL("CRITICAL"),

    HIGH("HIGH"),

    LOW("LOW"),

    NORMAL("NORMAL");

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

  private String body = null;

  private Map<String, Object> data = new HashMap<>();

  private String actionUrl = null;

  private String actorId = null;

  /**
   * What the notification is ABOUT. `null` when unset or unrecognized.
   */
  public enum ResourceTypeEnum {
    DOCUMENT("DOCUMENT"),

    ORGANIZATION("ORGANIZATION"),

    TICKET("TICKET"),

    USER("USER");

    private final String value;

    ResourceTypeEnum(String value) {
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
    public static ResourceTypeEnum fromValue(String value) {
      for (ResourceTypeEnum b : ResourceTypeEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private ResourceTypeEnum resourceType = null;

  private String resourceId = null;

  private String groupKey = null;

  private BigDecimal groupCount;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime readAt = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime archivedAt = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  public NotificationResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public NotificationResponseDto(
    String id,
    String organizationId,
    TypeEnum type,
    PriorityEnum priority,
    String title,
    String body,
    Map<String, Object> data,
    String actionUrl,
    String actorId,
    ResourceTypeEnum resourceType,
    String resourceId,
    String groupKey,
    BigDecimal groupCount,
    OffsetDateTime readAt,
    OffsetDateTime archivedAt,
    OffsetDateTime createdAt
  ) {
    this.id = id;
    this.organizationId = organizationId;
    this.type = type;
    this.priority = priority;
    this.title = title;
    this.body = body;
    this.data = data;
    this.actionUrl = actionUrl;
    this.actorId = actorId;
    this.resourceType = resourceType;
    this.resourceId = resourceId;
    this.groupKey = groupKey;
    this.groupCount = groupCount;
    this.readAt = readAt;
    this.archivedAt = archivedAt;
    this.createdAt = createdAt;
  }

  public NotificationResponseDto id(String id) {
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

  public NotificationResponseDto organizationId(String organizationId) {
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

  public NotificationResponseDto type(TypeEnum type) {
    this.type = type;
    return this;
  }

  /**
   * The ORIGINATING event — `ticket.assigned`, never the NATS subject.  `null` for a type this build does not recognise.
   * @return type
   */

  @JsonProperty("type")
  public TypeEnum getType() {
    return type;
  }

  @JsonProperty("type")
  public void setType(TypeEnum type) {
    this.type = type;
  }

  public NotificationResponseDto priority(PriorityEnum priority) {
    this.priority = priority;
    return this;
  }

  /**
   * How urgent it is. `null` when the wire value is one this build cannot name.
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

  public NotificationResponseDto title(String title) {
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

  public NotificationResponseDto body(String body) {
    this.body = body;
    return this;
  }

  /**
   * Get body
   * @return body
   */

  @JsonProperty("body")
  public String getBody() {
    return body;
  }

  @JsonProperty("body")
  public void setBody(String body) {
    this.body = body;
  }

  public NotificationResponseDto data(Map<String, Object> data) {
    this.data = data;
    return this;
  }

  public NotificationResponseDto putDataItem(String key, Object dataItem) {
    if (this.data == null) {
      this.data = new HashMap<>();
    }
    this.data.put(key, dataItem);
    return this;
  }

  /**
   * The event's payload, decoded from the JSON string the wire carries.
   * @return data
   */
  @NotNull
  @JsonProperty("data")
  public Map<String, Object> getData() {
    return data;
  }

  @JsonProperty("data")
  public void setData(Map<String, Object> data) {
    this.data = data;
  }

  public NotificationResponseDto actionUrl(String actionUrl) {
    this.actionUrl = actionUrl;
    return this;
  }

  /**
   * Get actionUrl
   * @return actionUrl
   */

  @JsonProperty("actionUrl")
  public String getActionUrl() {
    return actionUrl;
  }

  @JsonProperty("actionUrl")
  public void setActionUrl(String actionUrl) {
    this.actionUrl = actionUrl;
  }

  public NotificationResponseDto actorId(String actorId) {
    this.actorId = actorId;
    return this;
  }

  /**
   * Get actorId
   * @return actorId
   */

  @JsonProperty("actorId")
  public String getActorId() {
    return actorId;
  }

  @JsonProperty("actorId")
  public void setActorId(String actorId) {
    this.actorId = actorId;
  }

  public NotificationResponseDto resourceType(ResourceTypeEnum resourceType) {
    this.resourceType = resourceType;
    return this;
  }

  /**
   * What the notification is ABOUT. `null` when unset or unrecognized.
   * @return resourceType
   */

  @JsonProperty("resourceType")
  public ResourceTypeEnum getResourceType() {
    return resourceType;
  }

  @JsonProperty("resourceType")
  public void setResourceType(ResourceTypeEnum resourceType) {
    this.resourceType = resourceType;
  }

  public NotificationResponseDto resourceId(String resourceId) {
    this.resourceId = resourceId;
    return this;
  }

  /**
   * Get resourceId
   * @return resourceId
   */

  @JsonProperty("resourceId")
  public String getResourceId() {
    return resourceId;
  }

  @JsonProperty("resourceId")
  public void setResourceId(String resourceId) {
    this.resourceId = resourceId;
  }

  public NotificationResponseDto groupKey(String groupKey) {
    this.groupKey = groupKey;
    return this;
  }

  /**
   * What collapses several events into one row — free-form, and deliberately not an enum: the service composes it from a resource id.
   * @return groupKey
   */

  @JsonProperty("groupKey")
  public String getGroupKey() {
    return groupKey;
  }

  @JsonProperty("groupKey")
  public void setGroupKey(String groupKey) {
    this.groupKey = groupKey;
  }

  public NotificationResponseDto groupCount(BigDecimal groupCount) {
    this.groupCount = groupCount;
    return this;
  }

  /**
   * \"12 new messages on #1042\" — how many events this row represents.
   * @return groupCount
   */
  @NotNull
  @Valid
  @JsonProperty("groupCount")
  public BigDecimal getGroupCount() {
    return groupCount;
  }

  @JsonProperty("groupCount")
  public void setGroupCount(BigDecimal groupCount) {
    this.groupCount = groupCount;
  }

  public NotificationResponseDto readAt(OffsetDateTime readAt) {
    this.readAt = readAt;
    return this;
  }

  /**
   * Get readAt
   * @return readAt
   */
  @Valid
  @JsonProperty("readAt")
  public OffsetDateTime getReadAt() {
    return readAt;
  }

  @JsonProperty("readAt")
  public void setReadAt(OffsetDateTime readAt) {
    this.readAt = readAt;
  }

  public NotificationResponseDto archivedAt(OffsetDateTime archivedAt) {
    this.archivedAt = archivedAt;
    return this;
  }

  /**
   * Get archivedAt
   * @return archivedAt
   */
  @Valid
  @JsonProperty("archivedAt")
  public OffsetDateTime getArchivedAt() {
    return archivedAt;
  }

  @JsonProperty("archivedAt")
  public void setArchivedAt(OffsetDateTime archivedAt) {
    this.archivedAt = archivedAt;
  }

  public NotificationResponseDto createdAt(OffsetDateTime createdAt) {
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
    NotificationResponseDto notificationResponseDto =
      (NotificationResponseDto) o;
    return (
      Objects.equals(this.id, notificationResponseDto.id) &&
      Objects.equals(
        this.organizationId,
        notificationResponseDto.organizationId
      ) &&
      Objects.equals(this.type, notificationResponseDto.type) &&
      Objects.equals(this.priority, notificationResponseDto.priority) &&
      Objects.equals(this.title, notificationResponseDto.title) &&
      Objects.equals(this.body, notificationResponseDto.body) &&
      Objects.equals(this.data, notificationResponseDto.data) &&
      Objects.equals(this.actionUrl, notificationResponseDto.actionUrl) &&
      Objects.equals(this.actorId, notificationResponseDto.actorId) &&
      Objects.equals(this.resourceType, notificationResponseDto.resourceType) &&
      Objects.equals(this.resourceId, notificationResponseDto.resourceId) &&
      Objects.equals(this.groupKey, notificationResponseDto.groupKey) &&
      Objects.equals(this.groupCount, notificationResponseDto.groupCount) &&
      Objects.equals(this.readAt, notificationResponseDto.readAt) &&
      Objects.equals(this.archivedAt, notificationResponseDto.archivedAt) &&
      Objects.equals(this.createdAt, notificationResponseDto.createdAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      organizationId,
      type,
      priority,
      title,
      body,
      data,
      actionUrl,
      actorId,
      resourceType,
      resourceId,
      groupKey,
      groupCount,
      readAt,
      archivedAt,
      createdAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class NotificationResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    organizationId: ")
      .append(toIndentedString(organizationId))
      .append("\n");
    sb.append("    type: ").append(toIndentedString(type)).append("\n");
    sb.append("    priority: ").append(toIndentedString(priority)).append("\n");
    sb.append("    title: ").append(toIndentedString(title)).append("\n");
    sb.append("    body: ").append(toIndentedString(body)).append("\n");
    sb.append("    data: ").append(toIndentedString(data)).append("\n");
    sb.append("    actionUrl: ")
      .append(toIndentedString(actionUrl))
      .append("\n");
    sb.append("    actorId: ").append(toIndentedString(actorId)).append("\n");
    sb.append("    resourceType: ")
      .append(toIndentedString(resourceType))
      .append("\n");
    sb.append("    resourceId: ")
      .append(toIndentedString(resourceId))
      .append("\n");
    sb.append("    groupKey: ").append(toIndentedString(groupKey)).append("\n");
    sb.append("    groupCount: ")
      .append(toIndentedString(groupCount))
      .append("\n");
    sb.append("    readAt: ").append(toIndentedString(readAt)).append("\n");
    sb.append("    archivedAt: ")
      .append(toIndentedString(archivedAt))
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
