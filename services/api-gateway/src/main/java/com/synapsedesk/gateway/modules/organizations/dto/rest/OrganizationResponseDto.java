package com.synapsedesk.gateway.modules.organizations.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
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
 * OrganizationResponseDto
 */

public class OrganizationResponseDto {

  private String id;

  private String name;

  private String slug;

  private String domain = null;

  /**
   * `OrgStatus`, null when the bridge answers null for `UNSPECIFIED`
   */
  public enum StatusEnum {
    ACTIVE("ACTIVE"),

    FROZEN("FROZEN"),

    PENDING_ONBOARDING("PENDING_ONBOARDING"),

    SUSPENDED_PAST_DUE("SUSPENDED_PAST_DUE");

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

  private Boolean enforceTwoFactor;

  private List<String> allowedEmailDomains = new ArrayList<>();

  private BigDecimal maxAgentSeats;

  private BigDecimal maxStorageBytes;

  private BigDecimal monthlyAiTokenBudget;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime billingCycleStart;

  private BigDecimal analyticsRangeDays;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime updatedAt;

  public OrganizationResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public OrganizationResponseDto(
    String id,
    String name,
    String slug,
    String domain,
    StatusEnum status,
    Boolean enforceTwoFactor,
    List<String> allowedEmailDomains,
    BigDecimal maxAgentSeats,
    BigDecimal maxStorageBytes,
    BigDecimal monthlyAiTokenBudget,
    OffsetDateTime billingCycleStart,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
  ) {
    this.id = id;
    this.name = name;
    this.slug = slug;
    this.domain = domain;
    this.status = status;
    this.enforceTwoFactor = enforceTwoFactor;
    this.allowedEmailDomains = allowedEmailDomains;
    this.maxAgentSeats = maxAgentSeats;
    this.maxStorageBytes = maxStorageBytes;
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
    this.billingCycleStart = billingCycleStart;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  public OrganizationResponseDto id(String id) {
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

  public OrganizationResponseDto name(String name) {
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

  public OrganizationResponseDto slug(String slug) {
    this.slug = slug;
    return this;
  }

  /**
   * Get slug
   * @return slug
   */
  @NotNull
  @JsonProperty("slug")
  public String getSlug() {
    return slug;
  }

  @JsonProperty("slug")
  public void setSlug(String slug) {
    this.slug = slug;
  }

  public OrganizationResponseDto domain(String domain) {
    this.domain = domain;
    return this;
  }

  /**
   * Get domain
   * @return domain
   */

  @JsonProperty("domain")
  public String getDomain() {
    return domain;
  }

  @JsonProperty("domain")
  public void setDomain(String domain) {
    this.domain = domain;
  }

  public OrganizationResponseDto status(StatusEnum status) {
    this.status = status;
    return this;
  }

  /**
   * `OrgStatus`, null when the bridge answers null for `UNSPECIFIED`
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

  public OrganizationResponseDto enforceTwoFactor(Boolean enforceTwoFactor) {
    this.enforceTwoFactor = enforceTwoFactor;
    return this;
  }

  /**
   * Get enforceTwoFactor
   * @return enforceTwoFactor
   */
  @NotNull
  @JsonProperty("enforceTwoFactor")
  public Boolean getEnforceTwoFactor() {
    return enforceTwoFactor;
  }

  @JsonProperty("enforceTwoFactor")
  public void setEnforceTwoFactor(Boolean enforceTwoFactor) {
    this.enforceTwoFactor = enforceTwoFactor;
  }

  public OrganizationResponseDto allowedEmailDomains(
    List<String> allowedEmailDomains
  ) {
    this.allowedEmailDomains = allowedEmailDomains;
    return this;
  }

  public OrganizationResponseDto addAllowedEmailDomainsItem(
    String allowedEmailDomainsItem
  ) {
    if (this.allowedEmailDomains == null) {
      this.allowedEmailDomains = new ArrayList<>();
    }
    this.allowedEmailDomains.add(allowedEmailDomainsItem);
    return this;
  }

  /**
   * Get allowedEmailDomains
   * @return allowedEmailDomains
   */
  @NotNull
  @JsonProperty("allowedEmailDomains")
  public List<String> getAllowedEmailDomains() {
    return allowedEmailDomains;
  }

  @JsonProperty("allowedEmailDomains")
  public void setAllowedEmailDomains(List<String> allowedEmailDomains) {
    this.allowedEmailDomains = allowedEmailDomains;
  }

  public OrganizationResponseDto maxAgentSeats(BigDecimal maxAgentSeats) {
    this.maxAgentSeats = maxAgentSeats;
    return this;
  }

  /**
   * Get maxAgentSeats
   * @return maxAgentSeats
   */
  @NotNull
  @Valid
  @JsonProperty("maxAgentSeats")
  public BigDecimal getMaxAgentSeats() {
    return maxAgentSeats;
  }

  @JsonProperty("maxAgentSeats")
  public void setMaxAgentSeats(BigDecimal maxAgentSeats) {
    this.maxAgentSeats = maxAgentSeats;
  }

  public OrganizationResponseDto maxStorageBytes(BigDecimal maxStorageBytes) {
    this.maxStorageBytes = maxStorageBytes;
    return this;
  }

  /**
   * Get maxStorageBytes
   * @return maxStorageBytes
   */
  @NotNull
  @Valid
  @JsonProperty("maxStorageBytes")
  public BigDecimal getMaxStorageBytes() {
    return maxStorageBytes;
  }

  @JsonProperty("maxStorageBytes")
  public void setMaxStorageBytes(BigDecimal maxStorageBytes) {
    this.maxStorageBytes = maxStorageBytes;
  }

  public OrganizationResponseDto monthlyAiTokenBudget(
    BigDecimal monthlyAiTokenBudget
  ) {
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
    return this;
  }

  /**
   * Get monthlyAiTokenBudget
   * @return monthlyAiTokenBudget
   */
  @NotNull
  @Valid
  @JsonProperty("monthlyAiTokenBudget")
  public BigDecimal getMonthlyAiTokenBudget() {
    return monthlyAiTokenBudget;
  }

  @JsonProperty("monthlyAiTokenBudget")
  public void setMonthlyAiTokenBudget(BigDecimal monthlyAiTokenBudget) {
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
  }

  public OrganizationResponseDto billingCycleStart(
    OffsetDateTime billingCycleStart
  ) {
    this.billingCycleStart = billingCycleStart;
    return this;
  }

  /**
   * Get billingCycleStart
   * @return billingCycleStart
   */
  @NotNull
  @Valid
  @JsonProperty("billingCycleStart")
  public OffsetDateTime getBillingCycleStart() {
    return billingCycleStart;
  }

  @JsonProperty("billingCycleStart")
  public void setBillingCycleStart(OffsetDateTime billingCycleStart) {
    this.billingCycleStart = billingCycleStart;
  }

  public OrganizationResponseDto analyticsRangeDays(
    BigDecimal analyticsRangeDays
  ) {
    this.analyticsRangeDays = analyticsRangeDays;
    return this;
  }

  /**
   * Get analyticsRangeDays
   * @return analyticsRangeDays
   */
  @NotNull
  @Valid
  @JsonProperty("analyticsRangeDays")
  public BigDecimal getAnalyticsRangeDays() {
    return analyticsRangeDays;
  }

  @JsonProperty("analyticsRangeDays")
  public void setAnalyticsRangeDays(BigDecimal analyticsRangeDays) {
    this.analyticsRangeDays = analyticsRangeDays;
  }

  public OrganizationResponseDto createdAt(OffsetDateTime createdAt) {
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

  public OrganizationResponseDto updatedAt(OffsetDateTime updatedAt) {
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

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    OrganizationResponseDto organizationResponseDto =
      (OrganizationResponseDto) o;
    return (
      Objects.equals(this.id, organizationResponseDto.id) &&
      Objects.equals(this.name, organizationResponseDto.name) &&
      Objects.equals(this.slug, organizationResponseDto.slug) &&
      Objects.equals(this.domain, organizationResponseDto.domain) &&
      Objects.equals(this.status, organizationResponseDto.status) &&
      Objects.equals(
        this.enforceTwoFactor,
        organizationResponseDto.enforceTwoFactor
      ) &&
      Objects.equals(
        this.allowedEmailDomains,
        organizationResponseDto.allowedEmailDomains
      ) &&
      Objects.equals(
        this.maxAgentSeats,
        organizationResponseDto.maxAgentSeats
      ) &&
      Objects.equals(
        this.maxStorageBytes,
        organizationResponseDto.maxStorageBytes
      ) &&
      Objects.equals(
        this.monthlyAiTokenBudget,
        organizationResponseDto.monthlyAiTokenBudget
      ) &&
      Objects.equals(
        this.billingCycleStart,
        organizationResponseDto.billingCycleStart
      ) &&
      Objects.equals(this.createdAt, organizationResponseDto.createdAt) &&
      Objects.equals(this.updatedAt, organizationResponseDto.updatedAt) &&
      Objects.equals(
        this.analyticsRangeDays,
        organizationResponseDto.analyticsRangeDays
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      name,
      slug,
      domain,
      status,
      enforceTwoFactor,
      allowedEmailDomains,
      maxAgentSeats,
      maxStorageBytes,
      monthlyAiTokenBudget,
      billingCycleStart,
      createdAt,
      updatedAt,
      analyticsRangeDays
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class OrganizationResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    name: ").append(toIndentedString(name)).append("\n");
    sb.append("    slug: ").append(toIndentedString(slug)).append("\n");
    sb.append("    domain: ").append(toIndentedString(domain)).append("\n");
    sb.append("    status: ").append(toIndentedString(status)).append("\n");
    sb.append("    enforceTwoFactor: ")
      .append(toIndentedString(enforceTwoFactor))
      .append("\n");
    sb.append("    allowedEmailDomains: ")
      .append(toIndentedString(allowedEmailDomains))
      .append("\n");
    sb.append("    maxAgentSeats: ")
      .append(toIndentedString(maxAgentSeats))
      .append("\n");
    sb.append("    maxStorageBytes: ")
      .append(toIndentedString(maxStorageBytes))
      .append("\n");
    sb.append("    monthlyAiTokenBudget: ")
      .append(toIndentedString(monthlyAiTokenBudget))
      .append("\n");
    sb.append("    billingCycleStart: ")
      .append(toIndentedString(billingCycleStart))
      .append("\n");
    sb.append("    createdAt: ")
      .append(toIndentedString(createdAt))
      .append("\n");
    sb.append("    updatedAt: ")
      .append(toIndentedString(updatedAt))
      .append("\n");
    sb.append("    analyticsRangeDays: ")
      .append(toIndentedString(analyticsRangeDays))
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
