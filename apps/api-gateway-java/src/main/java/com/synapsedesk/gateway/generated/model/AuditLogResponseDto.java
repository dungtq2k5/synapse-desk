package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * AuditLogResponseDto
 */

public class AuditLogResponseDto {

  private String id;

  private String organizationId = null;

  private String userId = null;

  /**
   * What happened, as an `AuditAction`.  `null` for a row whose action THIS build cannot name — only reachable mid-rolling-deploy, and a client is better told \"unknown\" than handed a value its union does not contain.
   */
  public enum ActionEnum {
    DATA_EXPORT_REQUESTED("DATA_EXPORT_REQUESTED"),
    
    DEPARTMENT_CREATED("DEPARTMENT_CREATED"),
    
    DEPARTMENT_DELETED("DEPARTMENT_DELETED"),
    
    DEPARTMENT_MEMBERS_ADDED("DEPARTMENT_MEMBERS_ADDED"),
    
    DEPARTMENT_MEMBER_REMOVED("DEPARTMENT_MEMBER_REMOVED"),
    
    DEPARTMENT_RESTORED("DEPARTMENT_RESTORED"),
    
    DEPARTMENT_UPDATED("DEPARTMENT_UPDATED"),
    
    DOCUMENT_FLAG_DELETED("DOCUMENT_FLAG_DELETED"),
    
    DOCUMENT_FLAG_DISMISSED("DOCUMENT_FLAG_DISMISSED"),
    
    DOCUMENT_FLAG_RESOLVED("DOCUMENT_FLAG_RESOLVED"),
    
    ORGANIZATION_OFFBOARD_REQUESTED("ORGANIZATION_OFFBOARD_REQUESTED"),
    
    ORGANIZATION_ONBOARDING_COMPLETED("ORGANIZATION_ONBOARDING_COMPLETED"),
    
    ORGANIZATION_SETTINGS_UPDATED("ORGANIZATION_SETTINGS_UPDATED"),
    
    ORGANIZATION_UPDATED("ORGANIZATION_UPDATED"),
    
    PASSWORD_CHANGED("PASSWORD_CHANGED"),
    
    PLATFORM_BILLING_CYCLE_RESET("PLATFORM_BILLING_CYCLE_RESET"),
    
    PLATFORM_GLOBAL_ROLE_CREATED("PLATFORM_GLOBAL_ROLE_CREATED"),
    
    PLATFORM_ORGANIZATION_CREATED("PLATFORM_ORGANIZATION_CREATED"),
    
    PLATFORM_ORGANIZATION_OFFBOARDED("PLATFORM_ORGANIZATION_OFFBOARDED"),
    
    PLATFORM_ORGANIZATION_RESTORED("PLATFORM_ORGANIZATION_RESTORED"),
    
    PLATFORM_ORGANIZATION_STATUS_CHANGED("PLATFORM_ORGANIZATION_STATUS_CHANGED"),
    
    PLATFORM_ORGANIZATION_UPDATED("PLATFORM_ORGANIZATION_UPDATED"),
    
    PLATFORM_PLAN_APPLIED("PLATFORM_PLAN_APPLIED"),
    
    PLATFORM_PLAN_CREATED("PLATFORM_PLAN_CREATED"),
    
    PLATFORM_PLAN_DELETED("PLATFORM_PLAN_DELETED"),
    
    PLATFORM_PLAN_UPDATED("PLATFORM_PLAN_UPDATED"),
    
    ROLE_CREATED("ROLE_CREATED"),
    
    ROLE_DELETED("ROLE_DELETED"),
    
    ROLE_PERMISSIONS_UPDATED("ROLE_PERMISSIONS_UPDATED"),
    
    ROLE_UPDATED("ROLE_UPDATED"),
    
    USER_AVATAR_UPDATED("USER_AVATAR_UPDATED"),
    
    USER_CREATED("USER_CREATED"),
    
    USER_DELETED("USER_DELETED"),
    
    USER_DEPARTMENTS_UPDATED("USER_DEPARTMENTS_UPDATED"),
    
    USER_LOCKED("USER_LOCKED"),
    
    USER_LOGOUT_ALL("USER_LOGOUT_ALL"),
    
    USER_RESTORED("USER_RESTORED"),
    
    USER_ROLES_UPDATED("USER_ROLES_UPDATED"),
    
    USER_SESSIONS_REVOKED("USER_SESSIONS_REVOKED"),
    
    USER_TWO_FACTOR_RESET("USER_TWO_FACTOR_RESET"),
    
    USER_UNLOCKED("USER_UNLOCKED"),
    
    USER_UPDATED("USER_UPDATED");

    private final String value;

    ActionEnum(String value) {
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
    public static ActionEnum fromValue(String value) {
      for (ActionEnum b : ActionEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private ActionEnum action = null;

  /**
   * Gets or Sets resourceType
   */
  public enum ResourceTypeEnum {
    DEPARTMENT("DEPARTMENT"),
    
    DOCUMENT_FLAG("DOCUMENT_FLAG"),
    
    EXPORT("EXPORT"),
    
    ORGANIZATION("ORGANIZATION"),
    
    ROLE("ROLE"),
    
    SUBSCRIPTION_PLAN("SUBSCRIPTION_PLAN"),
    
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

  private String ipAddress = null;

  private String userAgent = null;

  private Map<String, Object> metadata = new HashMap<>();

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  public AuditLogResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AuditLogResponseDto(String id, String organizationId, String userId, ActionEnum action, ResourceTypeEnum resourceType, String resourceId, String ipAddress, String userAgent, Map<String, Object> metadata, OffsetDateTime createdAt) {
    this.id = id;
    this.organizationId = organizationId;
    this.userId = userId;
    this.action = action;
    this.resourceType = resourceType;
    this.resourceId = resourceId;
    this.ipAddress = ipAddress;
    this.userAgent = userAgent;
    this.metadata = metadata;
    this.createdAt = createdAt;
  }

  public AuditLogResponseDto id(String id) {
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

  public AuditLogResponseDto organizationId(String organizationId) {
    this.organizationId = organizationId;
    return this;
  }

  /**
   * null for a PLATFORM act — the event belongs to the platform, not a tenant.
   * @return organizationId
   */
  
  @JsonProperty("organizationId")
  public String getOrganizationId() {
    return organizationId;
  }

  @JsonProperty("organizationId")
  public void setOrganizationId(String organizationId) {
    this.organizationId = organizationId;
  }

  public AuditLogResponseDto userId(String userId) {
    this.userId = userId;
    return this;
  }

  /**
   * null for system and cron actors, which have no user acting for them.
   * @return userId
   */
  
  @JsonProperty("userId")
  public String getUserId() {
    return userId;
  }

  @JsonProperty("userId")
  public void setUserId(String userId) {
    this.userId = userId;
  }

  public AuditLogResponseDto action(ActionEnum action) {
    this.action = action;
    return this;
  }

  /**
   * What happened, as an `AuditAction`.  `null` for a row whose action THIS build cannot name — only reachable mid-rolling-deploy, and a client is better told \"unknown\" than handed a value its union does not contain.
   * @return action
   */
  
  @JsonProperty("action")
  public ActionEnum getAction() {
    return action;
  }

  @JsonProperty("action")
  public void setAction(ActionEnum action) {
    this.action = action;
  }

  public AuditLogResponseDto resourceType(ResourceTypeEnum resourceType) {
    this.resourceType = resourceType;
    return this;
  }

  /**
   * Get resourceType
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

  public AuditLogResponseDto resourceId(String resourceId) {
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

  public AuditLogResponseDto ipAddress(String ipAddress) {
    this.ipAddress = ipAddress;
    return this;
  }

  /**
   * Get ipAddress
   * @return ipAddress
   */
  
  @JsonProperty("ipAddress")
  public String getIpAddress() {
    return ipAddress;
  }

  @JsonProperty("ipAddress")
  public void setIpAddress(String ipAddress) {
    this.ipAddress = ipAddress;
  }

  public AuditLogResponseDto userAgent(String userAgent) {
    this.userAgent = userAgent;
    return this;
  }

  /**
   * Get userAgent
   * @return userAgent
   */
  
  @JsonProperty("userAgent")
  public String getUserAgent() {
    return userAgent;
  }

  @JsonProperty("userAgent")
  public void setUserAgent(String userAgent) {
    this.userAgent = userAgent;
  }

  public AuditLogResponseDto metadata(Map<String, Object> metadata) {
    this.metadata = metadata;
    return this;
  }

  public AuditLogResponseDto putMetadataItem(String key, Object metadataItem) {
    if (this.metadata == null) {
      this.metadata = new HashMap<>();
    }
    this.metadata.put(key, metadataItem);
    return this;
  }

  /**
   * Parsed back into an object for the client.  It crosses gRPC as a JSON string because the shape differs per action; a typed proto message could only be a `map<string, string>`, which would flatten every nested value in the before/after diff.
   * @return metadata
   */
  @NotNull 
  @JsonProperty("metadata")
  public Map<String, Object> getMetadata() {
    return metadata;
  }

  @JsonProperty("metadata")
  public void setMetadata(Map<String, Object> metadata) {
    this.metadata = metadata;
  }

  public AuditLogResponseDto createdAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  /**
   * Get createdAt
   * @return createdAt
   */
  @NotNull @Valid 
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
    AuditLogResponseDto auditLogResponseDto = (AuditLogResponseDto) o;
    return Objects.equals(this.id, auditLogResponseDto.id) &&
        Objects.equals(this.organizationId, auditLogResponseDto.organizationId) &&
        Objects.equals(this.userId, auditLogResponseDto.userId) &&
        Objects.equals(this.action, auditLogResponseDto.action) &&
        Objects.equals(this.resourceType, auditLogResponseDto.resourceType) &&
        Objects.equals(this.resourceId, auditLogResponseDto.resourceId) &&
        Objects.equals(this.ipAddress, auditLogResponseDto.ipAddress) &&
        Objects.equals(this.userAgent, auditLogResponseDto.userAgent) &&
        Objects.equals(this.metadata, auditLogResponseDto.metadata) &&
        Objects.equals(this.createdAt, auditLogResponseDto.createdAt);
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, organizationId, userId, action, resourceType, resourceId, ipAddress, userAgent, metadata, createdAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AuditLogResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    organizationId: ").append(toIndentedString(organizationId)).append("\n");
    sb.append("    userId: ").append(toIndentedString(userId)).append("\n");
    sb.append("    action: ").append(toIndentedString(action)).append("\n");
    sb.append("    resourceType: ").append(toIndentedString(resourceType)).append("\n");
    sb.append("    resourceId: ").append(toIndentedString(resourceId)).append("\n");
    sb.append("    ipAddress: ").append(toIndentedString(ipAddress)).append("\n");
    sb.append("    userAgent: ").append(toIndentedString(userAgent)).append("\n");
    sb.append("    metadata: ").append(toIndentedString(metadata)).append("\n");
    sb.append("    createdAt: ").append(toIndentedString(createdAt)).append("\n");
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

