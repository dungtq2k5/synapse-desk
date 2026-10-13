package com.synapsedesk.gateway.modules.auth.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * TenantOptionResponseDto
 */

public class TenantOptionResponseDto {

  private String organizationId;

  private String name;

  private String slug;

  public TenantOptionResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public TenantOptionResponseDto(
    String organizationId,
    String name,
    String slug
  ) {
    this.organizationId = organizationId;
    this.name = name;
    this.slug = slug;
  }

  public TenantOptionResponseDto organizationId(String organizationId) {
    this.organizationId = organizationId;
    return this;
  }

  /**
   * Get organizationId
   * @return organizationId
   */
  @NotNull
  @JsonProperty("organizationId")
  public String getOrganizationId() {
    return organizationId;
  }

  @JsonProperty("organizationId")
  public void setOrganizationId(String organizationId) {
    this.organizationId = organizationId;
  }

  public TenantOptionResponseDto name(String name) {
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

  public TenantOptionResponseDto slug(String slug) {
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

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    TenantOptionResponseDto tenantOptionResponseDto =
      (TenantOptionResponseDto) o;
    return (
      Objects.equals(
        this.organizationId,
        tenantOptionResponseDto.organizationId
      ) &&
      Objects.equals(this.name, tenantOptionResponseDto.name) &&
      Objects.equals(this.slug, tenantOptionResponseDto.slug)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(organizationId, name, slug);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class TenantOptionResponseDto {\n");
    sb.append("    organizationId: ")
      .append(toIndentedString(organizationId))
      .append("\n");
    sb.append("    name: ").append(toIndentedString(name)).append("\n");
    sb.append("    slug: ").append(toIndentedString(slug)).append("\n");
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
