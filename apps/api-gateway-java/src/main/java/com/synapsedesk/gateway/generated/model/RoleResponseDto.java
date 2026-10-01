package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * RoleResponseDto
 */

public class RoleResponseDto {

  private String id;

  private String name;

  private String description = null;

  private Boolean isSystemRole;

  private BigDecimal userAssigned;

  /**
   * Gets or Sets permissionCodes
   */
  public enum PermissionCodesEnum {
    ANALYTICS_READ("analytics.read"),
    
    AUDIT_EXPORT("audit.export"),
    
    AUDIT_READ("audit.read"),
    
    DEPARTMENT_CREATE("department.create"),
    
    DEPARTMENT_DELETE("department.delete"),
    
    DEPARTMENT_MEMBER_ASSIGN("department.member.assign"),
    
    DEPARTMENT_READ("department.read"),
    
    DEPARTMENT_UPDATE("department.update"),
    
    DOCUMENT_CREATE("document.create"),
    
    DOCUMENT_DELETE("document.delete"),
    
    DOCUMENT_READ("document.read"),
    
    DOCUMENT_REINDEX("document.reindex"),
    
    DOCUMENT_SHARE("document.share"),
    
    DOCUMENT_UPDATE("document.update"),
    
    ORGANIZATION_DELETE("organization.delete"),
    
    ORGANIZATION_READ("organization.read"),
    
    ORGANIZATION_UPDATE("organization.update"),
    
    ROLE_CREATE("role.create"),
    
    ROLE_DELETE("role.delete"),
    
    ROLE_PERMISSION_ASSIGN("role.permission.assign"),
    
    ROLE_READ("role.read"),
    
    ROLE_UPDATE("role.update"),
    
    TICKET_AI_USE("ticket.ai.use"),
    
    TICKET_ASSIGN("ticket.assign"),
    
    TICKET_ASSIGN_SELF("ticket.assign.self"),
    
    TICKET_CREATE("ticket.create"),
    
    TICKET_DELETE("ticket.delete"),
    
    TICKET_ESCALATE("ticket.escalate"),
    
    TICKET_EXPORT("ticket.export"),
    
    TICKET_MESSAGE_MODERATE("ticket.message.moderate"),
    
    TICKET_READ_ALL("ticket.read.all"),
    
    TICKET_REASSIGN("ticket.reassign"),
    
    TICKET_RESOLVE("ticket.resolve"),
    
    TICKET_UPDATE("ticket.update"),
    
    USER_2FA_RESET("user.2fa.reset"),
    
    USER_CREATE("user.create"),
    
    USER_DELETE("user.delete"),
    
    USER_INVITE("user.invite"),
    
    USER_LOCK("user.lock"),
    
    USER_READ("user.read"),
    
    USER_ROLE_ASSIGN("user.role.assign"),
    
    USER_SESSION_READ("user.session.read"),
    
    USER_SESSION_REVOKE("user.session.revoke"),
    
    USER_UPDATE("user.update");

    private final String value;

    PermissionCodesEnum(String value) {
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
    public static PermissionCodesEnum fromValue(String value) {
      for (PermissionCodesEnum b : PermissionCodesEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private List<PermissionCodesEnum> permissionCodes = new ArrayList<>();

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime updatedAt;

  public RoleResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public RoleResponseDto(String id, String name, String description, Boolean isSystemRole, BigDecimal userAssigned, List<PermissionCodesEnum> permissionCodes, OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.isSystemRole = isSystemRole;
    this.userAssigned = userAssigned;
    this.permissionCodes = permissionCodes;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  public RoleResponseDto id(String id) {
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

  public RoleResponseDto name(String name) {
    this.name = name;
    return this;
  }

  /**
   * Get name
   * @return name
   */
  @NotNull 
  @JsonProperty("name")
  public String getName() {
    return name;
  }

  @JsonProperty("name")
  public void setName(String name) {
    this.name = name;
  }

  public RoleResponseDto description(String description) {
    this.description = description;
    return this;
  }

  /**
   * Get description
   * @return description
   */
  
  @JsonProperty("description")
  public String getDescription() {
    return description;
  }

  @JsonProperty("description")
  public void setDescription(String description) {
    this.description = description;
  }

  public RoleResponseDto isSystemRole(Boolean isSystemRole) {
    this.isSystemRole = isSystemRole;
    return this;
  }

  /**
   * Readable by every tenant, mutable by none.
   * @return isSystemRole
   */
  @NotNull 
  @JsonProperty("isSystemRole")
  public Boolean getIsSystemRole() {
    return isSystemRole;
  }

  @JsonProperty("isSystemRole")
  public void setIsSystemRole(Boolean isSystemRole) {
    this.isSystemRole = isSystemRole;
  }

  public RoleResponseDto userAssigned(BigDecimal userAssigned) {
    this.userAssigned = userAssigned;
    return this;
  }

  /**
   * Get userAssigned
   * @return userAssigned
   */
  @NotNull @Valid 
  @JsonProperty("userAssigned")
  public BigDecimal getUserAssigned() {
    return userAssigned;
  }

  @JsonProperty("userAssigned")
  public void setUserAssigned(BigDecimal userAssigned) {
    this.userAssigned = userAssigned;
  }

  public RoleResponseDto permissionCodes(List<PermissionCodesEnum> permissionCodes) {
    this.permissionCodes = permissionCodes;
    return this;
  }

  public RoleResponseDto addPermissionCodesItem(PermissionCodesEnum permissionCodesItem) {
    if (this.permissionCodes == null) {
      this.permissionCodes = new ArrayList<>();
    }
    this.permissionCodes.add(permissionCodesItem);
    return this;
  }

  /**
   * Get permissionCodes
   * @return permissionCodes
   */
  @NotNull 
  @JsonProperty("permissionCodes")
  public List<PermissionCodesEnum> getPermissionCodes() {
    return permissionCodes;
  }

  @JsonProperty("permissionCodes")
  public void setPermissionCodes(List<PermissionCodesEnum> permissionCodes) {
    this.permissionCodes = permissionCodes;
  }

  public RoleResponseDto createdAt(OffsetDateTime createdAt) {
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

  public RoleResponseDto updatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
    return this;
  }

  /**
   * Get updatedAt
   * @return updatedAt
   */
  @NotNull @Valid 
  @JsonProperty("updatedAt")
  public OffsetDateTime getUpdatedAt() {
    return updatedAt;
  }

  @JsonProperty("updatedAt")
  public void setUpdatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    RoleResponseDto roleResponseDto = (RoleResponseDto) o;
    return Objects.equals(this.id, roleResponseDto.id) &&
        Objects.equals(this.name, roleResponseDto.name) &&
        Objects.equals(this.description, roleResponseDto.description) &&
        Objects.equals(this.isSystemRole, roleResponseDto.isSystemRole) &&
        Objects.equals(this.userAssigned, roleResponseDto.userAssigned) &&
        Objects.equals(this.permissionCodes, roleResponseDto.permissionCodes) &&
        Objects.equals(this.createdAt, roleResponseDto.createdAt) &&
        Objects.equals(this.updatedAt, roleResponseDto.updatedAt);
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, name, description, isSystemRole, userAssigned, permissionCodes, createdAt, updatedAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class RoleResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    name: ").append(toIndentedString(name)).append("\n");
    sb.append("    description: ").append(toIndentedString(description)).append("\n");
    sb.append("    isSystemRole: ").append(toIndentedString(isSystemRole)).append("\n");
    sb.append("    userAssigned: ").append(toIndentedString(userAssigned)).append("\n");
    sb.append("    permissionCodes: ").append(toIndentedString(permissionCodes)).append("\n");
    sb.append("    createdAt: ").append(toIndentedString(createdAt)).append("\n");
    sb.append("    updatedAt: ").append(toIndentedString(updatedAt)).append("\n");
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

