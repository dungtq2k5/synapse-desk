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
 * InvitationResponseDto
 */

public class InvitationResponseDto {

  private String id;

  private String email;

  /**
   * Gets or Sets status
   */
  public enum StatusEnum {
    ACCEPTED("ACCEPTED"),
    
    EXPIRED("EXPIRED"),
    
    PENDING("PENDING"),
    
    REVOKED("REVOKED");

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
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private StatusEnum status;

  private List<String> roleIds = new ArrayList<>();

  private List<String> departmentIds = new ArrayList<>();

  private String primaryDepartmentId = null;

  private String invitedByName = null;

  private BigDecimal resentCount;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime lastSentAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime expiresAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  public InvitationResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public InvitationResponseDto(String id, String email, StatusEnum status, List<String> roleIds, List<String> departmentIds, String primaryDepartmentId, String invitedByName, BigDecimal resentCount, OffsetDateTime lastSentAt, OffsetDateTime expiresAt, OffsetDateTime createdAt) {
    this.id = id;
    this.email = email;
    this.status = status;
    this.roleIds = roleIds;
    this.departmentIds = departmentIds;
    this.primaryDepartmentId = primaryDepartmentId;
    this.invitedByName = invitedByName;
    this.resentCount = resentCount;
    this.lastSentAt = lastSentAt;
    this.expiresAt = expiresAt;
    this.createdAt = createdAt;
  }

  public InvitationResponseDto id(String id) {
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

  public InvitationResponseDto email(String email) {
    this.email = email;
    return this;
  }

  /**
   * Get email
   * @return email
   */
  @NotNull 
  @JsonProperty("email")
  public String getEmail() {
    return email;
  }

  @JsonProperty("email")
  public void setEmail(String email) {
    this.email = email;
  }

  public InvitationResponseDto status(StatusEnum status) {
    this.status = status;
    return this;
  }

  /**
   * Get status
   * @return status
   */
  @NotNull 
  @JsonProperty("status")
  public StatusEnum getStatus() {
    return status;
  }

  @JsonProperty("status")
  public void setStatus(StatusEnum status) {
    this.status = status;
  }

  public InvitationResponseDto roleIds(List<String> roleIds) {
    this.roleIds = roleIds;
    return this;
  }

  public InvitationResponseDto addRoleIdsItem(String roleIdsItem) {
    if (this.roleIds == null) {
      this.roleIds = new ArrayList<>();
    }
    this.roleIds.add(roleIdsItem);
    return this;
  }

  /**
   * Get roleIds
   * @return roleIds
   */
  @NotNull 
  @JsonProperty("roleIds")
  public List<String> getRoleIds() {
    return roleIds;
  }

  @JsonProperty("roleIds")
  public void setRoleIds(List<String> roleIds) {
    this.roleIds = roleIds;
  }

  public InvitationResponseDto departmentIds(List<String> departmentIds) {
    this.departmentIds = departmentIds;
    return this;
  }

  public InvitationResponseDto addDepartmentIdsItem(String departmentIdsItem) {
    if (this.departmentIds == null) {
      this.departmentIds = new ArrayList<>();
    }
    this.departmentIds.add(departmentIdsItem);
    return this;
  }

  /**
   * Get departmentIds
   * @return departmentIds
   */
  @NotNull 
  @JsonProperty("departmentIds")
  public List<String> getDepartmentIds() {
    return departmentIds;
  }

  @JsonProperty("departmentIds")
  public void setDepartmentIds(List<String> departmentIds) {
    this.departmentIds = departmentIds;
  }

  public InvitationResponseDto primaryDepartmentId(String primaryDepartmentId) {
    this.primaryDepartmentId = primaryDepartmentId;
    return this;
  }

  /**
   * Get primaryDepartmentId
   * @return primaryDepartmentId
   */
  
  @JsonProperty("primaryDepartmentId")
  public String getPrimaryDepartmentId() {
    return primaryDepartmentId;
  }

  @JsonProperty("primaryDepartmentId")
  public void setPrimaryDepartmentId(String primaryDepartmentId) {
    this.primaryDepartmentId = primaryDepartmentId;
  }

  public InvitationResponseDto invitedByName(String invitedByName) {
    this.invitedByName = invitedByName;
    return this;
  }

  /**
   * Get invitedByName
   * @return invitedByName
   */
  
  @JsonProperty("invitedByName")
  public String getInvitedByName() {
    return invitedByName;
  }

  @JsonProperty("invitedByName")
  public void setInvitedByName(String invitedByName) {
    this.invitedByName = invitedByName;
  }

  public InvitationResponseDto resentCount(BigDecimal resentCount) {
    this.resentCount = resentCount;
    return this;
  }

  /**
   * Get resentCount
   * @return resentCount
   */
  @NotNull @Valid 
  @JsonProperty("resentCount")
  public BigDecimal getResentCount() {
    return resentCount;
  }

  @JsonProperty("resentCount")
  public void setResentCount(BigDecimal resentCount) {
    this.resentCount = resentCount;
  }

  public InvitationResponseDto lastSentAt(OffsetDateTime lastSentAt) {
    this.lastSentAt = lastSentAt;
    return this;
  }

  /**
   * Get lastSentAt
   * @return lastSentAt
   */
  @NotNull @Valid 
  @JsonProperty("lastSentAt")
  public OffsetDateTime getLastSentAt() {
    return lastSentAt;
  }

  @JsonProperty("lastSentAt")
  public void setLastSentAt(OffsetDateTime lastSentAt) {
    this.lastSentAt = lastSentAt;
  }

  public InvitationResponseDto expiresAt(OffsetDateTime expiresAt) {
    this.expiresAt = expiresAt;
    return this;
  }

  /**
   * Get expiresAt
   * @return expiresAt
   */
  @NotNull @Valid 
  @JsonProperty("expiresAt")
  public OffsetDateTime getExpiresAt() {
    return expiresAt;
  }

  @JsonProperty("expiresAt")
  public void setExpiresAt(OffsetDateTime expiresAt) {
    this.expiresAt = expiresAt;
  }

  public InvitationResponseDto createdAt(OffsetDateTime createdAt) {
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
    InvitationResponseDto invitationResponseDto = (InvitationResponseDto) o;
    return Objects.equals(this.id, invitationResponseDto.id) &&
        Objects.equals(this.email, invitationResponseDto.email) &&
        Objects.equals(this.status, invitationResponseDto.status) &&
        Objects.equals(this.roleIds, invitationResponseDto.roleIds) &&
        Objects.equals(this.departmentIds, invitationResponseDto.departmentIds) &&
        Objects.equals(this.primaryDepartmentId, invitationResponseDto.primaryDepartmentId) &&
        Objects.equals(this.invitedByName, invitationResponseDto.invitedByName) &&
        Objects.equals(this.resentCount, invitationResponseDto.resentCount) &&
        Objects.equals(this.lastSentAt, invitationResponseDto.lastSentAt) &&
        Objects.equals(this.expiresAt, invitationResponseDto.expiresAt) &&
        Objects.equals(this.createdAt, invitationResponseDto.createdAt);
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, email, status, roleIds, departmentIds, primaryDepartmentId, invitedByName, resentCount, lastSentAt, expiresAt, createdAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class InvitationResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    email: ").append(toIndentedString(email)).append("\n");
    sb.append("    status: ").append(toIndentedString(status)).append("\n");
    sb.append("    roleIds: ").append(toIndentedString(roleIds)).append("\n");
    sb.append("    departmentIds: ").append(toIndentedString(departmentIds)).append("\n");
    sb.append("    primaryDepartmentId: ").append(toIndentedString(primaryDepartmentId)).append("\n");
    sb.append("    invitedByName: ").append(toIndentedString(invitedByName)).append("\n");
    sb.append("    resentCount: ").append(toIndentedString(resentCount)).append("\n");
    sb.append("    lastSentAt: ").append(toIndentedString(lastSentAt)).append("\n");
    sb.append("    expiresAt: ").append(toIndentedString(expiresAt)).append("\n");
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

