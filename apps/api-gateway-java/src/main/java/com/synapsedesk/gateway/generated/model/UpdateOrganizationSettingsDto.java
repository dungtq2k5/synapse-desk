package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * UpdateOrganizationSettingsDto
 */

public class UpdateOrganizationSettingsDto {

  private @Nullable Boolean enforceTwoFactor;

  private List<String> allowedEmailDomains = new ArrayList<>();

  private @Nullable BigDecimal maxDocumentBytesOverride = null;

  private @Nullable BigDecimal maxAttachmentBytesOverride = null;

  private @Nullable BigDecimal maxAttachmentsPerMessageOverride = null;

  public UpdateOrganizationSettingsDto enforceTwoFactor(@Nullable Boolean enforceTwoFactor) {
    this.enforceTwoFactor = enforceTwoFactor;
    return this;
  }

  /**
   * Get enforceTwoFactor
   * @return enforceTwoFactor
   */
  
  @JsonProperty("enforceTwoFactor")
  public @Nullable Boolean getEnforceTwoFactor() {
    return enforceTwoFactor;
  }

  @JsonProperty("enforceTwoFactor")
  public void setEnforceTwoFactor(@Nullable Boolean enforceTwoFactor) {
    this.enforceTwoFactor = enforceTwoFactor;
  }

  public UpdateOrganizationSettingsDto allowedEmailDomains(List<String> allowedEmailDomains) {
    this.allowedEmailDomains = allowedEmailDomains;
    return this;
  }

  public UpdateOrganizationSettingsDto addAllowedEmailDomainsItem(String allowedEmailDomainsItem) {
    if (this.allowedEmailDomains == null) {
      this.allowedEmailDomains = new ArrayList<>();
    }
    this.allowedEmailDomains.add(allowedEmailDomainsItem);
    return this;
  }

  /**
   * REPLACE semantics when present, untouched when absent.  The gateway can tell the two apart (`undefined` vs `[]`) but protobuf cannot, which is why the client sets an explicit replace flag on the wire.
   * @return allowedEmailDomains
   */
  
  @JsonProperty("allowedEmailDomains")
  public List<String> getAllowedEmailDomains() {
    return allowedEmailDomains;
  }

  @JsonProperty("allowedEmailDomains")
  public void setAllowedEmailDomains(List<String> allowedEmailDomains) {
    this.allowedEmailDomains = allowedEmailDomains;
  }

  public UpdateOrganizationSettingsDto maxDocumentBytesOverride(@Nullable BigDecimal maxDocumentBytesOverride) {
    this.maxDocumentBytesOverride = maxDocumentBytesOverride;
    return this;
  }

  /**
   * The largest document this workspace will accept, at or below the platform ceiling. `null` clears it; an absent key leaves it unchanged.
   * minimum: 1
   * maximum: 104857600
   * @return maxDocumentBytesOverride
   */
  @Valid @DecimalMin(value = "1") @DecimalMax(value = "104857600") 
  @JsonProperty("maxDocumentBytesOverride")
  public @Nullable BigDecimal getMaxDocumentBytesOverride() {
    return maxDocumentBytesOverride;
  }

  @JsonProperty("maxDocumentBytesOverride")
  public void setMaxDocumentBytesOverride(@Nullable BigDecimal maxDocumentBytesOverride) {
    this.maxDocumentBytesOverride = maxDocumentBytesOverride;
  }

  public UpdateOrganizationSettingsDto maxAttachmentBytesOverride(@Nullable BigDecimal maxAttachmentBytesOverride) {
    this.maxAttachmentBytesOverride = maxAttachmentBytesOverride;
    return this;
  }

  /**
   * See {@link UpdateOrganizationSettingsDto.maxDocumentBytesOverride}.
   * minimum: 1
   * maximum: 10485760
   * @return maxAttachmentBytesOverride
   */
  @Valid @DecimalMin(value = "1") @DecimalMax(value = "10485760") 
  @JsonProperty("maxAttachmentBytesOverride")
  public @Nullable BigDecimal getMaxAttachmentBytesOverride() {
    return maxAttachmentBytesOverride;
  }

  @JsonProperty("maxAttachmentBytesOverride")
  public void setMaxAttachmentBytesOverride(@Nullable BigDecimal maxAttachmentBytesOverride) {
    this.maxAttachmentBytesOverride = maxAttachmentBytesOverride;
  }

  public UpdateOrganizationSettingsDto maxAttachmentsPerMessageOverride(@Nullable BigDecimal maxAttachmentsPerMessageOverride) {
    this.maxAttachmentsPerMessageOverride = maxAttachmentsPerMessageOverride;
    return this;
  }

  /**
   * See {@link UpdateOrganizationSettingsDto.maxDocumentBytesOverride}.
   * minimum: 1
   * maximum: 5
   * @return maxAttachmentsPerMessageOverride
   */
  @Valid @DecimalMin(value = "1") @DecimalMax(value = "5") 
  @JsonProperty("maxAttachmentsPerMessageOverride")
  public @Nullable BigDecimal getMaxAttachmentsPerMessageOverride() {
    return maxAttachmentsPerMessageOverride;
  }

  @JsonProperty("maxAttachmentsPerMessageOverride")
  public void setMaxAttachmentsPerMessageOverride(@Nullable BigDecimal maxAttachmentsPerMessageOverride) {
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
    UpdateOrganizationSettingsDto updateOrganizationSettingsDto = (UpdateOrganizationSettingsDto) o;
    return Objects.equals(this.enforceTwoFactor, updateOrganizationSettingsDto.enforceTwoFactor) &&
        Objects.equals(this.allowedEmailDomains, updateOrganizationSettingsDto.allowedEmailDomains) &&
        Objects.equals(this.maxDocumentBytesOverride, updateOrganizationSettingsDto.maxDocumentBytesOverride) &&
        Objects.equals(this.maxAttachmentBytesOverride, updateOrganizationSettingsDto.maxAttachmentBytesOverride) &&
        Objects.equals(this.maxAttachmentsPerMessageOverride, updateOrganizationSettingsDto.maxAttachmentsPerMessageOverride);
  }

  @Override
  public int hashCode() {
    return Objects.hash(enforceTwoFactor, allowedEmailDomains, maxDocumentBytesOverride, maxAttachmentBytesOverride, maxAttachmentsPerMessageOverride);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UpdateOrganizationSettingsDto {\n");
    sb.append("    enforceTwoFactor: ").append(toIndentedString(enforceTwoFactor)).append("\n");
    sb.append("    allowedEmailDomains: ").append(toIndentedString(allowedEmailDomains)).append("\n");
    sb.append("    maxDocumentBytesOverride: ").append(toIndentedString(maxDocumentBytesOverride)).append("\n");
    sb.append("    maxAttachmentBytesOverride: ").append(toIndentedString(maxAttachmentBytesOverride)).append("\n");
    sb.append("    maxAttachmentsPerMessageOverride: ").append(toIndentedString(maxAttachmentsPerMessageOverride)).append("\n");
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

