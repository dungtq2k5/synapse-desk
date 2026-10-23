package com.synapsedesk.gateway.modules.platform.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.modules.organizations.dto.rest.OrganizationResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * PlatformOrganizationResponseDto
 */

public class PlatformOrganizationResponseDto {

  private OrganizationResponseDto organization;

  private BigDecimal userCount;

  private BigDecimal pendingInvitationCount;

  private BigDecimal departmentCount;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime deletedAt = null;

  private String planName = null;

  private Boolean billedThroughStripe;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime statusChangedAt = null;

  private Boolean entitlementsPinned;

  private Boolean planAssigned;

  public PlatformOrganizationResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PlatformOrganizationResponseDto(
    OrganizationResponseDto organization,
    BigDecimal userCount,
    BigDecimal pendingInvitationCount,
    BigDecimal departmentCount,
    OffsetDateTime deletedAt
  ) {
    this.organization = organization;
    this.userCount = userCount;
    this.pendingInvitationCount = pendingInvitationCount;
    this.departmentCount = departmentCount;
    this.deletedAt = deletedAt;
  }

  public PlatformOrganizationResponseDto organization(
    OrganizationResponseDto organization
  ) {
    this.organization = organization;
    return this;
  }

  /**
   * Get organization
   * @return organization
   */
  @NotNull
  @Valid
  @JsonProperty("organization")
  public OrganizationResponseDto getOrganization() {
    return organization;
  }

  @JsonProperty("organization")
  public void setOrganization(OrganizationResponseDto organization) {
    this.organization = organization;
  }

  public PlatformOrganizationResponseDto userCount(BigDecimal userCount) {
    this.userCount = userCount;
    return this;
  }

  /**
   * Get userCount
   * @return userCount
   */
  @NotNull
  @Valid
  @JsonProperty("userCount")
  public BigDecimal getUserCount() {
    return userCount;
  }

  @JsonProperty("userCount")
  public void setUserCount(BigDecimal userCount) {
    this.userCount = userCount;
  }

  public PlatformOrganizationResponseDto pendingInvitationCount(
    BigDecimal pendingInvitationCount
  ) {
    this.pendingInvitationCount = pendingInvitationCount;
    return this;
  }

  /**
   * Get pendingInvitationCount
   * @return pendingInvitationCount
   */
  @NotNull
  @Valid
  @JsonProperty("pendingInvitationCount")
  public BigDecimal getPendingInvitationCount() {
    return pendingInvitationCount;
  }

  @JsonProperty("pendingInvitationCount")
  public void setPendingInvitationCount(BigDecimal pendingInvitationCount) {
    this.pendingInvitationCount = pendingInvitationCount;
  }

  public PlatformOrganizationResponseDto departmentCount(
    BigDecimal departmentCount
  ) {
    this.departmentCount = departmentCount;
    return this;
  }

  /**
   * Get departmentCount
   * @return departmentCount
   */
  @NotNull
  @Valid
  @JsonProperty("departmentCount")
  public BigDecimal getDepartmentCount() {
    return departmentCount;
  }

  @JsonProperty("departmentCount")
  public void setDepartmentCount(BigDecimal departmentCount) {
    this.departmentCount = departmentCount;
  }

  public PlatformOrganizationResponseDto deletedAt(OffsetDateTime deletedAt) {
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

  public PlatformOrganizationResponseDto planName(String planName) {
    this.planName = planName;
    return this;
  }

  /**
   * Get planName
   * @return planName
   */
  @JsonProperty("planName")
  public String getPlanName() {
    return planName;
  }

  @JsonProperty("planName")
  public void setPlanName(String planName) {
    this.planName = planName;
  }

  public PlatformOrganizationResponseDto billedThroughStripe(
    Boolean billedThroughStripe
  ) {
    this.billedThroughStripe = billedThroughStripe;
    return this;
  }

  /**
   * Get billedThroughStripe
   * @return billedThroughStripe
   */
  @NotNull
  @JsonProperty("billedThroughStripe")
  public Boolean getBilledThroughStripe() {
    return billedThroughStripe;
  }

  @JsonProperty("billedThroughStripe")
  public void setBilledThroughStripe(Boolean billedThroughStripe) {
    this.billedThroughStripe = billedThroughStripe;
  }

  public PlatformOrganizationResponseDto statusChangedAt(
    OffsetDateTime statusChangedAt
  ) {
    this.statusChangedAt = statusChangedAt;
    return this;
  }

  /**
   * Get statusChangedAt
   * @return statusChangedAt
   */
  @JsonProperty("statusChangedAt")
  public OffsetDateTime getStatusChangedAt() {
    return statusChangedAt;
  }

  @JsonProperty("statusChangedAt")
  public void setStatusChangedAt(OffsetDateTime statusChangedAt) {
    this.statusChangedAt = statusChangedAt;
  }

  public PlatformOrganizationResponseDto entitlementsPinned(
    Boolean entitlementsPinned
  ) {
    this.entitlementsPinned = entitlementsPinned;
    return this;
  }

  /**
   * Get entitlementsPinned
   * @return entitlementsPinned
   */
  @NotNull
  @JsonProperty("entitlementsPinned")
  public Boolean getEntitlementsPinned() {
    return entitlementsPinned;
  }

  @JsonProperty("entitlementsPinned")
  public void setEntitlementsPinned(Boolean entitlementsPinned) {
    this.entitlementsPinned = entitlementsPinned;
  }

  public PlatformOrganizationResponseDto planAssigned(Boolean planAssigned) {
    this.planAssigned = planAssigned;
    return this;
  }

  /**
   * Get planAssigned
   * @return planAssigned
   */
  @NotNull
  @JsonProperty("planAssigned")
  public Boolean getPlanAssigned() {
    return planAssigned;
  }

  @JsonProperty("planAssigned")
  public void setPlanAssigned(Boolean planAssigned) {
    this.planAssigned = planAssigned;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    PlatformOrganizationResponseDto platformOrganizationResponseDto =
      (PlatformOrganizationResponseDto) o;
    return (
      Objects.equals(
        this.organization,
        platformOrganizationResponseDto.organization
      ) &&
      Objects.equals(
        this.userCount,
        platformOrganizationResponseDto.userCount
      ) &&
      Objects.equals(
        this.pendingInvitationCount,
        platformOrganizationResponseDto.pendingInvitationCount
      ) &&
      Objects.equals(
        this.departmentCount,
        platformOrganizationResponseDto.departmentCount
      ) &&
      Objects.equals(
        this.deletedAt,
        platformOrganizationResponseDto.deletedAt
      ) &&
      Objects.equals(this.planName, platformOrganizationResponseDto.planName) &&
      Objects.equals(
        this.billedThroughStripe,
        platformOrganizationResponseDto.billedThroughStripe
      ) &&
      Objects.equals(
        this.statusChangedAt,
        platformOrganizationResponseDto.statusChangedAt
      ) &&
      Objects.equals(
        this.entitlementsPinned,
        platformOrganizationResponseDto.entitlementsPinned
      ) &&
      Objects.equals(
        this.planAssigned,
        platformOrganizationResponseDto.planAssigned
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      organization,
      userCount,
      pendingInvitationCount,
      departmentCount,
      deletedAt,
      planName,
      billedThroughStripe,
      statusChangedAt,
      entitlementsPinned,
      planAssigned
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PlatformOrganizationResponseDto {\n");
    sb.append("    organization: ")
      .append(toIndentedString(organization))
      .append("\n");
    sb.append("    userCount: ")
      .append(toIndentedString(userCount))
      .append("\n");
    sb.append("    pendingInvitationCount: ")
      .append(toIndentedString(pendingInvitationCount))
      .append("\n");
    sb.append("    departmentCount: ")
      .append(toIndentedString(departmentCount))
      .append("\n");
    sb.append("    deletedAt: ")
      .append(toIndentedString(deletedAt))
      .append("\n");
    sb.append("    planName: ").append(toIndentedString(planName)).append("\n");
    sb.append("    billedThroughStripe: ")
      .append(toIndentedString(billedThroughStripe))
      .append("\n");
    sb.append("    statusChangedAt: ")
      .append(toIndentedString(statusChangedAt))
      .append("\n");
    sb.append("    entitlementsPinned: ")
      .append(toIndentedString(entitlementsPinned))
      .append("\n");
    sb.append("    planAssigned: ")
      .append(toIndentedString(planAssigned))
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
