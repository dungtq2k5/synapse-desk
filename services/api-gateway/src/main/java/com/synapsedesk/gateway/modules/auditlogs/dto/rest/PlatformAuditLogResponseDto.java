package com.synapsedesk.gateway.modules.auditlogs.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * A platform entry, with the names the page shows beside the ids.
 */

public class PlatformAuditLogResponseDto extends AuditLogResponseDto {

  private String actorName = null;

  private String resourceName = null;

  public PlatformAuditLogResponseDto() {
    super();
  }

  /** The entry as the tenant trail maps it, with room for its names. */
  public static PlatformAuditLogResponseDto of(AuditLogResponseDto entry) {
    PlatformAuditLogResponseDto named = new PlatformAuditLogResponseDto();
    named.setId(entry.getId());
    named.setOrganizationId(entry.getOrganizationId());
    named.setUserId(entry.getUserId());
    named.setAction(entry.getAction());
    named.setResourceType(entry.getResourceType());
    named.setResourceId(entry.getResourceId());
    named.setIpAddress(entry.getIpAddress());
    named.setUserAgent(entry.getUserAgent());
    named.setMetadata(entry.getMetadata());
    named.setCreatedAt(entry.getCreatedAt());
    return named;
  }

  public PlatformAuditLogResponseDto actorName(String actorName) {
    this.actorName = actorName;
    return this;
  }

  /**
   * Get actorName
   * @return actorName
   */
  @JsonProperty("actorName")
  public String getActorName() {
    return actorName;
  }

  @JsonProperty("actorName")
  public void setActorName(String actorName) {
    this.actorName = actorName;
  }

  public PlatformAuditLogResponseDto resourceName(String resourceName) {
    this.resourceName = resourceName;
    return this;
  }

  /**
   * Get resourceName
   * @return resourceName
   */
  @JsonProperty("resourceName")
  public String getResourceName() {
    return resourceName;
  }

  @JsonProperty("resourceName")
  public void setResourceName(String resourceName) {
    this.resourceName = resourceName;
  }

  @Override
  public boolean equals(Object o) {
    if (!super.equals(o)) {
      return false;
    }
    PlatformAuditLogResponseDto other = (PlatformAuditLogResponseDto) o;
    return (
      Objects.equals(this.actorName, other.actorName) &&
      Objects.equals(this.resourceName, other.resourceName)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(super.hashCode(), actorName, resourceName);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PlatformAuditLogResponseDto {\n");
    sb.append("    ").append(indentedValue(super.toString())).append("\n");
    sb.append("    actorName: ").append(indentedValue(actorName)).append("\n");
    sb.append("    resourceName: ")
      .append(indentedValue(resourceName))
      .append("\n");
    sb.append("}");
    return sb.toString();
  }

  /**
   * Convert the given object to string with each line indented by 4 spaces
   * (except the first line).
   */
  private String indentedValue(@Nullable Object o) {
    return o == null ? "null" : o.toString().replace("\n", "\n    ");
  }
}
