package com.synapsedesk.gateway.auth;

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
    String userAgent) {

  public RequestOrigin origin() {
    return new RequestOrigin(ip, userAgent);
  }
}
