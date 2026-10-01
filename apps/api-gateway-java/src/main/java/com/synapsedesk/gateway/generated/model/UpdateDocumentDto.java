package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * UpdateDocumentDto
 */

public class UpdateDocumentDto {

  private @Nullable String title;

  private @Nullable Boolean isOrganizationWide;

  public UpdateDocumentDto title(@Nullable String title) {
    this.title = title;
    return this;
  }

  /**
   * Get title
   * @return title
   */
  @Size(min = 1, max = 255) 
  @JsonProperty("title")
  public @Nullable String getTitle() {
    return title;
  }

  @JsonProperty("title")
  public void setTitle(@Nullable String title) {
    this.title = title;
  }

  public UpdateDocumentDto isOrganizationWide(@Nullable Boolean isOrganizationWide) {
    this.isOrganizationWide = isOrganizationWide;
    return this;
  }

  /**
   * Get isOrganizationWide
   * @return isOrganizationWide
   */
  
  @JsonProperty("isOrganizationWide")
  public @Nullable Boolean getIsOrganizationWide() {
    return isOrganizationWide;
  }

  @JsonProperty("isOrganizationWide")
  public void setIsOrganizationWide(@Nullable Boolean isOrganizationWide) {
    this.isOrganizationWide = isOrganizationWide;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UpdateDocumentDto updateDocumentDto = (UpdateDocumentDto) o;
    return Objects.equals(this.title, updateDocumentDto.title) &&
        Objects.equals(this.isOrganizationWide, updateDocumentDto.isOrganizationWide);
  }

  @Override
  public int hashCode() {
    return Objects.hash(title, isOrganizationWide);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UpdateDocumentDto {\n");
    sb.append("    title: ").append(toIndentedString(title)).append("\n");
    sb.append("    isOrganizationWide: ").append(toIndentedString(isOrganizationWide)).append("\n");
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

