package com.synapsedesk.gateway.common.auth;

import java.util.List;

/**
 * A fully authenticated caller — `JwtPrincipal` plus provenance.
 *
 * <p>Built only by {@link CurrentUser}, and only from a principal for which
 * {@link JwtPrincipal#isFullSession()} is true, mirroring
 * `RequestContextService.fromRequest` rejecting a 2FA-pending payload.
 */
public record RequestContext(
  String sub,
  String organizationId,
  boolean isSuperAdmin,
  List<String> departmentIds,
  List<String> permissionCodes,
  boolean isEmailVerified,
  String ip,
  String userAgent
) {
  /**
   * The organization, or the empty string for a caller with none (a super admin
   * carries {@code isSuperAdmin} with a null organization).
   *
   * <p>What a protobuf string field takes: its setter refuses {@code null}, which
   * would answer 500 before any peer is called; the empty default lets the peer
   * decide. Every request to a peer that names the caller's organization goes
   * through this, so there is one definition of "none".
   */
  public String organizationIdOrEmpty() {
    return organizationId == null ? "" : organizationId;
  }

  public RequestOrigin origin() {
    return new RequestOrigin(ip, userAgent);
  }
}
