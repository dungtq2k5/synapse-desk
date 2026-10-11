package com.synapsedesk.gateway.modules.organizations.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
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
 * OrganizationSettingsResponseDto
 */

public class OrganizationSettingsResponseDto {

  private Boolean enforceTwoFactor;

  private List<String> allowedEmailDomains = new ArrayList<>();

  private List<String> publicDomainWarnings = new ArrayList<>();

  private BigDecimal maxDocumentBytesOverride = null;

  private BigDecimal maxAttachmentBytesOverride = null;

  private BigDecimal maxAttachmentsPerMessageOverride = null;

  public OrganizationSettingsResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public OrganizationSettingsResponseDto(
    Boolean enforceTwoFactor,
    List<String> allowedEmailDomains,
    List<String> publicDomainWarnings,
    BigDecimal maxDocumentBytesOverride,
    BigDecimal maxAttachmentBytesOverride,
    BigDecimal maxAttachmentsPerMessageOverride
  ) {
    this.enforceTwoFactor = enforceTwoFactor;
    this.allowedEmailDomains = allowedEmailDomains;
    this.publicDomainWarnings = publicDomainWarnings;
    this.maxDocumentBytesOverride = maxDocumentBytesOverride;
    this.maxAttachmentBytesOverride = maxAttachmentBytesOverride;
    this.maxAttachmentsPerMessageOverride = maxAttachmentsPerMessageOverride;
  }

  public OrganizationSettingsResponseDto enforceTwoFactor(
    Boolean enforceTwoFactor
  ) {
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

  public OrganizationSettingsResponseDto allowedEmailDomains(
    List<String> allowedEmailDomains
  ) {
    this.allowedEmailDomains = allowedEmailDomains;
    return this;
  }

  public OrganizationSettingsResponseDto addAllowedEmailDomainsItem(
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

  public OrganizationSettingsResponseDto publicDomainWarnings(
    List<String> publicDomainWarnings
  ) {
    this.publicDomainWarnings = publicDomainWarnings;
    return this;
  }

  public OrganizationSettingsResponseDto addPublicDomainWarningsItem(
    String publicDomainWarningsItem
  ) {
    if (this.publicDomainWarnings == null) {
      this.publicDomainWarnings = new ArrayList<>();
    }
    this.publicDomainWarnings.add(publicDomainWarningsItem);
    return this;
  }

  /**
   * Accepted free-mail domains worth a second look. Never an error.
   * @return publicDomainWarnings
   */
  @NotNull
  @JsonProperty("publicDomainWarnings")
  public List<String> getPublicDomainWarnings() {
    return publicDomainWarnings;
  }

  @JsonProperty("publicDomainWarnings")
  public void setPublicDomainWarnings(List<String> publicDomainWarnings) {
    this.publicDomainWarnings = publicDomainWarnings;
  }

  public OrganizationSettingsResponseDto maxDocumentBytesOverride(
    BigDecimal maxDocumentBytesOverride
  ) {
    this.maxDocumentBytesOverride = maxDocumentBytesOverride;
    return this;
  }

  /**
   * What this workspace has configured, or `null` where it has configured nothing.  `null` rather than the platform number: a screen that renders the ceiling as if the tenant had chosen it cannot show the difference between an inherited limit and a deliberate one, and the tenant would have no way to tell whether clearing the field changes anything.
   * @return maxDocumentBytesOverride
   */
  @Valid
  @JsonProperty("maxDocumentBytesOverride")
  public BigDecimal getMaxDocumentBytesOverride() {
    return maxDocumentBytesOverride;
  }

  @JsonProperty("maxDocumentBytesOverride")
  public void setMaxDocumentBytesOverride(BigDecimal maxDocumentBytesOverride) {
    this.maxDocumentBytesOverride = maxDocumentBytesOverride;
  }

  public OrganizationSettingsResponseDto maxAttachmentBytesOverride(
    BigDecimal maxAttachmentBytesOverride
  ) {
    this.maxAttachmentBytesOverride = maxAttachmentBytesOverride;
    return this;
  }

  /**
   * Get maxAttachmentBytesOverride
   * @return maxAttachmentBytesOverride
   */
  @Valid
  @JsonProperty("maxAttachmentBytesOverride")
  public BigDecimal getMaxAttachmentBytesOverride() {
    return maxAttachmentBytesOverride;
  }

  @JsonProperty("maxAttachmentBytesOverride")
  public void setMaxAttachmentBytesOverride(
    BigDecimal maxAttachmentBytesOverride
  ) {
    this.maxAttachmentBytesOverride = maxAttachmentBytesOverride;
  }

  public OrganizationSettingsResponseDto maxAttachmentsPerMessageOverride(
    BigDecimal maxAttachmentsPerMessageOverride
  ) {
    this.maxAttachmentsPerMessageOverride = maxAttachmentsPerMessageOverride;
    return this;
  }

  /**
   * Get maxAttachmentsPerMessageOverride
   * @return maxAttachmentsPerMessageOverride
   */
  @Valid
  @JsonProperty("maxAttachmentsPerMessageOverride")
  public BigDecimal getMaxAttachmentsPerMessageOverride() {
    return maxAttachmentsPerMessageOverride;
  }

  @JsonProperty("maxAttachmentsPerMessageOverride")
  public void setMaxAttachmentsPerMessageOverride(
    BigDecimal maxAttachmentsPerMessageOverride
  ) {
    this.maxAttachmentsPerMessageOverride = maxAttachmentsPerMessageOverride;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    OrganizationSettingsResponseDto organizationSettingsResponseDto =
      (OrganizationSettingsResponseDto) o;
    return (
      Objects.equals(
        this.enforceTwoFactor,
        organizationSettingsResponseDto.enforceTwoFactor
      ) &&
      Objects.equals(
        this.allowedEmailDomains,
        organizationSettingsResponseDto.allowedEmailDomains
      ) &&
      Objects.equals(
        this.publicDomainWarnings,
        organizationSettingsResponseDto.publicDomainWarnings
      ) &&
      Objects.equals(
        this.maxDocumentBytesOverride,
        organizationSettingsResponseDto.maxDocumentBytesOverride
      ) &&
      Objects.equals(
        this.maxAttachmentBytesOverride,
        organizationSettingsResponseDto.maxAttachmentBytesOverride
      ) &&
      Objects.equals(
        this.maxAttachmentsPerMessageOverride,
        organizationSettingsResponseDto.maxAttachmentsPerMessageOverride
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      enforceTwoFactor,
      allowedEmailDomains,
      publicDomainWarnings,
      maxDocumentBytesOverride,
      maxAttachmentBytesOverride,
      maxAttachmentsPerMessageOverride
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class OrganizationSettingsResponseDto {\n");
    sb.append("    enforceTwoFactor: ")
      .append(toIndentedString(enforceTwoFactor))
      .append("\n");
    sb.append("    allowedEmailDomains: ")
      .append(toIndentedString(allowedEmailDomains))
      .append("\n");
    sb.append("    publicDomainWarnings: ")
      .append(toIndentedString(publicDomainWarnings))
      .append("\n");
    sb.append("    maxDocumentBytesOverride: ")
      .append(toIndentedString(maxDocumentBytesOverride))
      .append("\n");
    sb.append("    maxAttachmentBytesOverride: ")
      .append(toIndentedString(maxAttachmentBytesOverride))
      .append("\n");
    sb.append("    maxAttachmentsPerMessageOverride: ")
      .append(toIndentedString(maxAttachmentsPerMessageOverride))
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
