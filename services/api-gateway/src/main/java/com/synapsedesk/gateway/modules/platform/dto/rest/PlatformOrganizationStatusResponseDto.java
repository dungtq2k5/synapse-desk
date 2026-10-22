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
 * A status change: the organization, and the sessions it ended.
 */

public class PlatformOrganizationStatusResponseDto {

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

  private BigDecimal revokedSessionCount;

  public PlatformOrganizationStatusResponseDto() {
    super();
  }

  public PlatformOrganizationStatusResponseDto organization(
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

  public PlatformOrganizationStatusResponseDto userCount(BigDecimal userCount) {
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

  public PlatformOrganizationStatusResponseDto pendingInvitationCount(
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

  public PlatformOrganizationStatusResponseDto departmentCount(
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

  public PlatformOrganizationStatusResponseDto deletedAt(
    OffsetDateTime deletedAt
  ) {
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

  public PlatformOrganizationStatusResponseDto planName(String planName) {
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

  public PlatformOrganizationStatusResponseDto billedThroughStripe(
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

  public PlatformOrganizationStatusResponseDto statusChangedAt(
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

  public PlatformOrganizationStatusResponseDto revokedSessionCount(
    BigDecimal revokedSessionCount
  ) {
    this.revokedSessionCount = revokedSessionCount;
    return this;
  }

  /**
   * Get revokedSessionCount
   * @return revokedSessionCount
   */
  @NotNull
  @Valid
  @JsonProperty("revokedSessionCount")
  public BigDecimal getRevokedSessionCount() {
    return revokedSessionCount;
  }

  @JsonProperty("revokedSessionCount")
  public void setRevokedSessionCount(BigDecimal revokedSessionCount) {
    this.revokedSessionCount = revokedSessionCount;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    PlatformOrganizationStatusResponseDto platformOrganizationStatusResponseDto =
      (PlatformOrganizationStatusResponseDto) o;
    return (
      Objects.equals(
        this.organization,
        platformOrganizationStatusResponseDto.organization
      ) &&
      Objects.equals(
        this.userCount,
        platformOrganizationStatusResponseDto.userCount
      ) &&
      Objects.equals(
        this.pendingInvitationCount,
        platformOrganizationStatusResponseDto.pendingInvitationCount
      ) &&
      Objects.equals(
        this.departmentCount,
        platformOrganizationStatusResponseDto.departmentCount
      ) &&
      Objects.equals(
        this.deletedAt,
        platformOrganizationStatusResponseDto.deletedAt
      ) &&
      Objects.equals(
        this.planName,
        platformOrganizationStatusResponseDto.planName
      ) &&
      Objects.equals(
        this.billedThroughStripe,
        platformOrganizationStatusResponseDto.billedThroughStripe
      ) &&
      Objects.equals(
        this.statusChangedAt,
        platformOrganizationStatusResponseDto.statusChangedAt
      ) &&
      Objects.equals(
        this.revokedSessionCount,
        platformOrganizationStatusResponseDto.revokedSessionCount
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
      revokedSessionCount
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PlatformOrganizationStatusResponseDto {\n");
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
    sb.append("    revokedSessionCount: ")
      .append(toIndentedString(revokedSessionCount))
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
