package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * DepartmentResponseDto
 */

public class DepartmentResponseDto {

  private String id;

  private String name;

  private String description = null;

  private BigDecimal memberCount;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime deletedAt = null;

  private String deletedByName = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime updatedAt;

  public DepartmentResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DepartmentResponseDto(String id, String name, String description, BigDecimal memberCount, OffsetDateTime deletedAt, String deletedByName, OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.memberCount = memberCount;
    this.deletedAt = deletedAt;
    this.deletedByName = deletedByName;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  public DepartmentResponseDto id(String id) {
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

  public DepartmentResponseDto name(String name) {
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

  public DepartmentResponseDto description(String description) {
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

  public DepartmentResponseDto memberCount(BigDecimal memberCount) {
    this.memberCount = memberCount;
    return this;
  }

  /**
   * Get memberCount
   * @return memberCount
   */
  @NotNull @Valid 
  @JsonProperty("memberCount")
  public BigDecimal getMemberCount() {
    return memberCount;
  }

  @JsonProperty("memberCount")
  public void setMemberCount(BigDecimal memberCount) {
    this.memberCount = memberCount;
  }

  public DepartmentResponseDto deletedAt(OffsetDateTime deletedAt) {
    this.deletedAt = deletedAt;
    return this;
  }

  /**
   * Non-null only on a soft-deleted row.
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

  public DepartmentResponseDto deletedByName(String deletedByName) {
    this.deletedByName = deletedByName;
    return this;
  }

  /**
   * Get deletedByName
   * @return deletedByName
   */
  
  @JsonProperty("deletedByName")
  public String getDeletedByName() {
    return deletedByName;
  }

  @JsonProperty("deletedByName")
  public void setDeletedByName(String deletedByName) {
    this.deletedByName = deletedByName;
  }

  public DepartmentResponseDto createdAt(OffsetDateTime createdAt) {
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

  public DepartmentResponseDto updatedAt(OffsetDateTime updatedAt) {
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
    DepartmentResponseDto departmentResponseDto = (DepartmentResponseDto) o;
    return Objects.equals(this.id, departmentResponseDto.id) &&
        Objects.equals(this.name, departmentResponseDto.name) &&
        Objects.equals(this.description, departmentResponseDto.description) &&
        Objects.equals(this.memberCount, departmentResponseDto.memberCount) &&
        Objects.equals(this.deletedAt, departmentResponseDto.deletedAt) &&
        Objects.equals(this.deletedByName, departmentResponseDto.deletedByName) &&
        Objects.equals(this.createdAt, departmentResponseDto.createdAt) &&
        Objects.equals(this.updatedAt, departmentResponseDto.updatedAt);
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, name, description, memberCount, deletedAt, deletedByName, createdAt, updatedAt);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DepartmentResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    name: ").append(toIndentedString(name)).append("\n");
    sb.append("    description: ").append(toIndentedString(description)).append("\n");
    sb.append("    memberCount: ").append(toIndentedString(memberCount)).append("\n");
    sb.append("    deletedAt: ").append(toIndentedString(deletedAt)).append("\n");
    sb.append("    deletedByName: ").append(toIndentedString(deletedByName)).append("\n");
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

