package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * UpdatePlatformOrganizationDto
 */

public class UpdatePlatformOrganizationDto {

  private @Nullable String name;

  private @Nullable String slug;

  private @Nullable String domain;

  private @Nullable BigDecimal maxAgentSeats;

  private @Nullable BigDecimal maxStorageBytes;

  private @Nullable BigDecimal monthlyAiTokenBudget;

  public UpdatePlatformOrganizationDto name(@Nullable String name) {
    this.name = name;
    return this;
  }

  /**
   * Get name
   * @return name
   */
  @Size(min = 2, max = 255)
  @JsonProperty("name")
  public @Nullable String getName() {
    return name;
  }

  @JsonProperty("name")
  public void setName(@Nullable String name) {
    this.name = name;
  }

  public UpdatePlatformOrganizationDto slug(@Nullable String slug) {
    this.slug = slug;
    return this;
  }

  /**
   * Get slug
   * @return slug
   */
  @Size(min = 2, max = 100)
  @JsonProperty("slug")
  public @Nullable String getSlug() {
    return slug;
  }

  @JsonProperty("slug")
  public void setSlug(@Nullable String slug) {
    this.slug = slug;
  }

  public UpdatePlatformOrganizationDto domain(@Nullable String domain) {
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

  public UpdatePlatformOrganizationDto maxAgentSeats(
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

  public UpdatePlatformOrganizationDto maxStorageBytes(
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

  public UpdatePlatformOrganizationDto monthlyAiTokenBudget(
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
    UpdatePlatformOrganizationDto updatePlatformOrganizationDto =
      (UpdatePlatformOrganizationDto) o;
    return (
      Objects.equals(this.name, updatePlatformOrganizationDto.name) &&
      Objects.equals(this.slug, updatePlatformOrganizationDto.slug) &&
      Objects.equals(this.domain, updatePlatformOrganizationDto.domain) &&
      Objects.equals(
        this.maxAgentSeats,
        updatePlatformOrganizationDto.maxAgentSeats
      ) &&
      Objects.equals(
        this.maxStorageBytes,
        updatePlatformOrganizationDto.maxStorageBytes
      ) &&
      Objects.equals(
        this.monthlyAiTokenBudget,
        updatePlatformOrganizationDto.monthlyAiTokenBudget
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      name,
      slug,
      domain,
      maxAgentSeats,
      maxStorageBytes,
      monthlyAiTokenBudget
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UpdatePlatformOrganizationDto {\n");
    sb.append("    name: ").append(toIndentedString(name)).append("\n");
    sb.append("    slug: ").append(toIndentedString(slug)).append("\n");
    sb.append("    domain: ").append(toIndentedString(domain)).append("\n");
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
