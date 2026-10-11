package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.common.validation.Matches;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * UpdateOrganizationDto
 */

public class UpdateOrganizationDto {

  private @Nullable String name;

  private @Nullable String slug;

  private @Nullable String domain;

  public UpdateOrganizationDto name(@Nullable String name) {
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

  public UpdateOrganizationDto slug(@Nullable String slug) {
    this.slug = slug;
    return this;
  }

  /**
   * Appears in URLs, so changing it breaks every existing link. Treated as a rename with consequences rather than a cosmetic edit — the service rejects a collision with 409 rather than silently suffixing it.
   * @return slug
   */
  @Size(min = 2, max = 100)
  @Matches(regex = "^[a-z0-9-]+$")
  @JsonProperty("slug")
  public @Nullable String getSlug() {
    return slug;
  }

  @JsonProperty("slug")
  public void setSlug(@Nullable String slug) {
    this.slug = slug;
  }

  public UpdateOrganizationDto domain(@Nullable String domain) {
    this.domain = domain;
    return this;
  }

  /**
   * Empty string clears it. Globally unique across tenants.
   * @return domain
   */
  @Size(max = 255)
  @Matches(
    regex = "^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$"
  )
  @JsonProperty("domain")
  public @Nullable String getDomain() {
    return domain;
  }

  @JsonProperty("domain")
  public void setDomain(@Nullable String domain) {
    this.domain = domain;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UpdateOrganizationDto updateOrganizationDto = (UpdateOrganizationDto) o;
    return (
      Objects.equals(this.name, updateOrganizationDto.name) &&
      Objects.equals(this.slug, updateOrganizationDto.slug) &&
      Objects.equals(this.domain, updateOrganizationDto.domain)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(name, slug, domain);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UpdateOrganizationDto {\n");
    sb.append("    name: ").append(toIndentedString(name)).append("\n");
    sb.append("    slug: ").append(toIndentedString(slug)).append("\n");
    sb.append("    domain: ").append(toIndentedString(domain)).append("\n");
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
