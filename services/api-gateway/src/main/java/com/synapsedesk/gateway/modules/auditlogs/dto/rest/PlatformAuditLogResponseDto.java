package com.synapsedesk.gateway.modules.auditlogs.dto.rest;

/**
 * A platform entry: the Super Admin who acted, and the organization or plan
 * acted on.
 */
public class PlatformAuditLogResponseDto extends AuditLogResponseDto {

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
    named.setActorName(entry.getActorName());
    named.setResourceName(entry.getResourceName());
    return named;
  }
}
