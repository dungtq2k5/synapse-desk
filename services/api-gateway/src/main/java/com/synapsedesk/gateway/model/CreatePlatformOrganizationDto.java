package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * CreatePlatformOrganizationDto
 */

public class CreatePlatformOrganizationDto {

  private List<String> allowedEmailDomains = new ArrayList<>();

  private String name;

  private String slug;

  private @Nullable String domain;

  private String adminEmail;

  private String adminFullName;

  private @Nullable BigDecimal maxAgentSeats;

  private @Nullable BigDecimal maxStorageBytes;

  private @Nullable BigDecimal monthlyAiTokenBudget;

  public CreatePlatformOrganizationDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public CreatePlatformOrganizationDto(
    String name,
    String slug,
    String adminEmail,
    String adminFullName
  ) {
    this.name = name;
    this.slug = slug;
    this.adminEmail = adminEmail;
    this.adminFullName = adminFullName;
  }

  public CreatePlatformOrganizationDto allowedEmailDomains(
    List<String> allowedEmailDomains
  ) {
    this.allowedEmailDomains = allowedEmailDomains;
    return this;
  }

  public CreatePlatformOrganizationDto addAllowedEmailDomainsItem(
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

  @Schema(defaultValue = "[]")
  @JsonProperty("allowedEmailDomains")
  public List<String> getAllowedEmailDomains() {
    return allowedEmailDomains;
  }

  @JsonProperty("allowedEmailDomains")
  public void setAllowedEmailDomains(List<String> allowedEmailDomains) {
    this.allowedEmailDomains = allowedEmailDomains;
  }

  public CreatePlatformOrganizationDto name(String name) {
    this.name = name;
    return this;
  }

  /**
   * Get name
   * @return name
   */
  @NotNull
  @Size(min = 2, max = 255)
  @JsonProperty("name")
  public String getName() {
    return name;
  }

  @JsonProperty("name")
  public void setName(String name) {
    this.name = name;
  }

  public CreatePlatformOrganizationDto slug(String slug) {
    this.slug = slug;
    return this;
  }

  /**
   * Get slug
   * @return slug
   */
  @NotNull
  @Size(min = 2, max = 100)
  @JsonProperty("slug")
  public String getSlug() {
    return slug;
  }

  @JsonProperty("slug")
  public void setSlug(String slug) {
    this.slug = slug;
  }

  public CreatePlatformOrganizationDto domain(@Nullable String domain) {
    this.domain = domain;
    return this;
  }

  /**
   * Get domain
   * @return domain
   */
  @Size(max = 255)
  @JsonProperty("domain")
  public @Nullable String getDomain() {
    return domain;
  }

  @JsonProperty("domain")
  public void setDomain(@Nullable String domain) {
    this.domain = domain;
  }

  public CreatePlatformOrganizationDto adminEmail(String adminEmail) {
    this.adminEmail = adminEmail;
    return this;
  }

  /**
   * Get adminEmail
   * @return adminEmail
   */
  @NotNull
  @jakarta.validation.constraints.Email
  @JsonProperty("adminEmail")
  public String getAdminEmail() {
    return adminEmail;
  }

  @JsonProperty("adminEmail")
  public void setAdminEmail(String adminEmail) {
    this.adminEmail = adminEmail;
  }

  public CreatePlatformOrganizationDto adminFullName(String adminFullName) {
    this.adminFullName = adminFullName;
    return this;
  }

  /**
   * Get adminFullName
   * @return adminFullName
   */
  @NotNull
  @Size(min = 2, max = 150)
  @JsonProperty("adminFullName")
  public String getAdminFullName() {
    return adminFullName;
  }

  @JsonProperty("adminFullName")
  public void setAdminFullName(String adminFullName) {
    this.adminFullName = adminFullName;
  }

  public CreatePlatformOrganizationDto maxAgentSeats(
    @Nullable BigDecimal maxAgentSeats
  ) {
    this.maxAgentSeats = maxAgentSeats;
    return this;
  }

  /**
   * Get maxAgentSeats
   * minimum: 1
   * @return maxAgentSeats
   */
  @Valid
  @DecimalMin(value = "1")
  @JsonProperty("maxAgentSeats")
  public @Nullable BigDecimal getMaxAgentSeats() {
    return maxAgentSeats;
  }

  @JsonProperty("maxAgentSeats")
  public void setMaxAgentSeats(@Nullable BigDecimal maxAgentSeats) {
    this.maxAgentSeats = maxAgentSeats;
  }

  public CreatePlatformOrganizationDto maxStorageBytes(
    @Nullable BigDecimal maxStorageBytes
  ) {
    this.maxStorageBytes = maxStorageBytes;
    return this;
  }

  /**
   * Get maxStorageBytes
   * minimum: 0
   * @return maxStorageBytes
   */
  @Valid
  @DecimalMin(value = "0")
  @JsonProperty("maxStorageBytes")
  public @Nullable BigDecimal getMaxStorageBytes() {
    return maxStorageBytes;
  }

  @JsonProperty("maxStorageBytes")
  public void setMaxStorageBytes(@Nullable BigDecimal maxStorageBytes) {
    this.maxStorageBytes = maxStorageBytes;
  }

  public CreatePlatformOrganizationDto monthlyAiTokenBudget(
    @Nullable BigDecimal monthlyAiTokenBudget
  ) {
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
    return this;
  }

  /**
   * Get monthlyAiTokenBudget
   * minimum: 0
   * @return monthlyAiTokenBudget
   */
  @Valid
  @DecimalMin(value = "0")
  @JsonProperty("monthlyAiTokenBudget")
  public @Nullable BigDecimal getMonthlyAiTokenBudget() {
    return monthlyAiTokenBudget;
  }

  @JsonProperty("monthlyAiTokenBudget")
  public void setMonthlyAiTokenBudget(
    @Nullable BigDecimal monthlyAiTokenBudget
  ) {
    this.monthlyAiTokenBudget = monthlyAiTokenBudget;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    CreatePlatformOrganizationDto createPlatformOrganizationDto =
      (CreatePlatformOrganizationDto) o;
    return (
      Objects.equals(
        this.allowedEmailDomains,
        createPlatformOrganizationDto.allowedEmailDomains
      ) &&
      Objects.equals(this.name, createPlatformOrganizationDto.name) &&
      Objects.equals(this.slug, createPlatformOrganizationDto.slug) &&
      Objects.equals(this.domain, createPlatformOrganizationDto.domain) &&
      Objects.equals(
        this.adminEmail,
        createPlatformOrganizationDto.adminEmail
      ) &&
      Objects.equals(
        this.adminFullName,
        createPlatformOrganizationDto.adminFullName
      ) &&
      Objects.equals(
        this.maxAgentSeats,
        createPlatformOrganizationDto.maxAgentSeats
      ) &&
      Objects.equals(
        this.maxStorageBytes,
        createPlatformOrganizationDto.maxStorageBytes
      ) &&
      Objects.equals(
        this.monthlyAiTokenBudget,
        createPlatformOrganizationDto.monthlyAiTokenBudget
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      allowedEmailDomains,
      name,
      slug,
      domain,
      adminEmail,
      adminFullName,
      maxAgentSeats,
      maxStorageBytes,
      monthlyAiTokenBudget
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class CreatePlatformOrganizationDto {\n");
    sb.append("    allowedEmailDomains: ")
      .append(toIndentedString(allowedEmailDomains))
      .append("\n");
    sb.append("    name: ").append(toIndentedString(name)).append("\n");
    sb.append("    slug: ").append(toIndentedString(slug)).append("\n");
    sb.append("    domain: ").append(toIndentedString(domain)).append("\n");
    sb.append("    adminEmail: ")
      .append(toIndentedString(adminEmail))
      .append("\n");
    sb.append("    adminFullName: ")
      .append(toIndentedString(adminFullName))
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
