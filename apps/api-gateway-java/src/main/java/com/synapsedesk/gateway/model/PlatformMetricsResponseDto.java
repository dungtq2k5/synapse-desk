package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
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
 * PlatformMetricsResponseDto
 */

public class PlatformMetricsResponseDto {

  private BigDecimal totalOrganizations;

  private Map<String, BigDecimal> organizationsByStatus = new HashMap<>();

  private BigDecimal totalUsers;

  private BigDecimal activeUsers;

  private BigDecimal pendingInvitations;

  private BigDecimal liveSessions;

  private BigDecimal seatsAllocated;

  private BigDecimal seatsInUse;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime generatedAt;

  public PlatformMetricsResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PlatformMetricsResponseDto(
    BigDecimal totalOrganizations,
    Map<String, BigDecimal> organizationsByStatus,
    BigDecimal totalUsers,
    BigDecimal activeUsers,
    BigDecimal pendingInvitations,
    BigDecimal liveSessions,
    BigDecimal seatsAllocated,
    BigDecimal seatsInUse,
    OffsetDateTime generatedAt
  ) {
    this.totalOrganizations = totalOrganizations;
    this.organizationsByStatus = organizationsByStatus;
    this.totalUsers = totalUsers;
    this.activeUsers = activeUsers;
    this.pendingInvitations = pendingInvitations;
    this.liveSessions = liveSessions;
    this.seatsAllocated = seatsAllocated;
    this.seatsInUse = seatsInUse;
    this.generatedAt = generatedAt;
  }

  public PlatformMetricsResponseDto totalOrganizations(
    BigDecimal totalOrganizations
  ) {
    this.totalOrganizations = totalOrganizations;
    return this;
  }

  /**
   * Get totalOrganizations
   * @return totalOrganizations
   */
  @NotNull
  @Valid
  @JsonProperty("totalOrganizations")
  public BigDecimal getTotalOrganizations() {
    return totalOrganizations;
  }

  @JsonProperty("totalOrganizations")
  public void setTotalOrganizations(BigDecimal totalOrganizations) {
    this.totalOrganizations = totalOrganizations;
  }

  public PlatformMetricsResponseDto organizationsByStatus(
    Map<String, BigDecimal> organizationsByStatus
  ) {
    this.organizationsByStatus = organizationsByStatus;
    return this;
  }

  public PlatformMetricsResponseDto putOrganizationsByStatusItem(
    String key,
    BigDecimal organizationsByStatusItem
  ) {
    if (this.organizationsByStatus == null) {
      this.organizationsByStatus = new HashMap<>();
    }
    this.organizationsByStatus.put(key, organizationsByStatusItem);
    return this;
  }

  /**
   * Get organizationsByStatus
   * @return organizationsByStatus
   */
  @NotNull
  @Valid
  @JsonProperty("organizationsByStatus")
  public Map<String, BigDecimal> getOrganizationsByStatus() {
    return organizationsByStatus;
  }

  @JsonProperty("organizationsByStatus")
  public void setOrganizationsByStatus(
    Map<String, BigDecimal> organizationsByStatus
  ) {
    this.organizationsByStatus = organizationsByStatus;
  }

  public PlatformMetricsResponseDto totalUsers(BigDecimal totalUsers) {
    this.totalUsers = totalUsers;
    return this;
  }

  /**
   * Get totalUsers
   * @return totalUsers
   */
  @NotNull
  @Valid
  @JsonProperty("totalUsers")
  public BigDecimal getTotalUsers() {
    return totalUsers;
  }

  @JsonProperty("totalUsers")
  public void setTotalUsers(BigDecimal totalUsers) {
    this.totalUsers = totalUsers;
  }

  public PlatformMetricsResponseDto activeUsers(BigDecimal activeUsers) {
    this.activeUsers = activeUsers;
    return this;
  }

  /**
   * Get activeUsers
   * @return activeUsers
   */
  @NotNull
  @Valid
  @JsonProperty("activeUsers")
  public BigDecimal getActiveUsers() {
    return activeUsers;
  }

  @JsonProperty("activeUsers")
  public void setActiveUsers(BigDecimal activeUsers) {
    this.activeUsers = activeUsers;
  }

  public PlatformMetricsResponseDto pendingInvitations(
    BigDecimal pendingInvitations
  ) {
    this.pendingInvitations = pendingInvitations;
    return this;
  }

  /**
   * Get pendingInvitations
   * @return pendingInvitations
   */
  @NotNull
  @Valid
  @JsonProperty("pendingInvitations")
  public BigDecimal getPendingInvitations() {
    return pendingInvitations;
  }

  @JsonProperty("pendingInvitations")
  public void setPendingInvitations(BigDecimal pendingInvitations) {
    this.pendingInvitations = pendingInvitations;
  }

  public PlatformMetricsResponseDto liveSessions(BigDecimal liveSessions) {
    this.liveSessions = liveSessions;
    return this;
  }

  /**
   * Get liveSessions
   * @return liveSessions
   */
  @NotNull
  @Valid
  @JsonProperty("liveSessions")
  public BigDecimal getLiveSessions() {
    return liveSessions;
  }

  @JsonProperty("liveSessions")
  public void setLiveSessions(BigDecimal liveSessions) {
    this.liveSessions = liveSessions;
  }

  public PlatformMetricsResponseDto seatsAllocated(BigDecimal seatsAllocated) {
    this.seatsAllocated = seatsAllocated;
    return this;
  }

  /**
   * Get seatsAllocated
   * @return seatsAllocated
   */
  @NotNull
  @Valid
  @JsonProperty("seatsAllocated")
  public BigDecimal getSeatsAllocated() {
    return seatsAllocated;
  }

  @JsonProperty("seatsAllocated")
  public void setSeatsAllocated(BigDecimal seatsAllocated) {
    this.seatsAllocated = seatsAllocated;
  }

  public PlatformMetricsResponseDto seatsInUse(BigDecimal seatsInUse) {
    this.seatsInUse = seatsInUse;
    return this;
  }

  /**
   * Get seatsInUse
   * @return seatsInUse
   */
  @NotNull
  @Valid
  @JsonProperty("seatsInUse")
  public BigDecimal getSeatsInUse() {
    return seatsInUse;
  }

  @JsonProperty("seatsInUse")
  public void setSeatsInUse(BigDecimal seatsInUse) {
    this.seatsInUse = seatsInUse;
  }

  public PlatformMetricsResponseDto generatedAt(OffsetDateTime generatedAt) {
    this.generatedAt = generatedAt;
    return this;
  }

  /**
   * Get generatedAt
   * @return generatedAt
   */
  @NotNull
  @Valid
  @JsonProperty("generatedAt")
  public OffsetDateTime getGeneratedAt() {
    return generatedAt;
  }

  @JsonProperty("generatedAt")
  public void setGeneratedAt(OffsetDateTime generatedAt) {
    this.generatedAt = generatedAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    PlatformMetricsResponseDto platformMetricsResponseDto =
      (PlatformMetricsResponseDto) o;
    return (
      Objects.equals(
        this.totalOrganizations,
        platformMetricsResponseDto.totalOrganizations
      ) &&
      Objects.equals(
        this.organizationsByStatus,
        platformMetricsResponseDto.organizationsByStatus
      ) &&
      Objects.equals(this.totalUsers, platformMetricsResponseDto.totalUsers) &&
      Objects.equals(
        this.activeUsers,
        platformMetricsResponseDto.activeUsers
      ) &&
      Objects.equals(
        this.pendingInvitations,
        platformMetricsResponseDto.pendingInvitations
      ) &&
      Objects.equals(
        this.liveSessions,
        platformMetricsResponseDto.liveSessions
      ) &&
      Objects.equals(
        this.seatsAllocated,
        platformMetricsResponseDto.seatsAllocated
      ) &&
      Objects.equals(this.seatsInUse, platformMetricsResponseDto.seatsInUse) &&
      Objects.equals(this.generatedAt, platformMetricsResponseDto.generatedAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      totalOrganizations,
      organizationsByStatus,
      totalUsers,
      activeUsers,
      pendingInvitations,
      liveSessions,
      seatsAllocated,
      seatsInUse,
      generatedAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PlatformMetricsResponseDto {\n");
    sb.append("    totalOrganizations: ")
      .append(toIndentedString(totalOrganizations))
      .append("\n");
    sb.append("    organizationsByStatus: ")
      .append(toIndentedString(organizationsByStatus))
      .append("\n");
    sb.append("    totalUsers: ")
      .append(toIndentedString(totalUsers))
      .append("\n");
    sb.append("    activeUsers: ")
      .append(toIndentedString(activeUsers))
      .append("\n");
    sb.append("    pendingInvitations: ")
      .append(toIndentedString(pendingInvitations))
      .append("\n");
    sb.append("    liveSessions: ")
      .append(toIndentedString(liveSessions))
      .append("\n");
    sb.append("    seatsAllocated: ")
      .append(toIndentedString(seatsAllocated))
      .append("\n");
    sb.append("    seatsInUse: ")
      .append(toIndentedString(seatsInUse))
      .append("\n");
    sb.append("    generatedAt: ")
      .append(toIndentedString(generatedAt))
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
