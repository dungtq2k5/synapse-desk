package com.synapsedesk.gateway.common.auth;

import java.util.List;

/**
 * What the gateway VERIFIED off an access token — the Java `JwtPayload`.
 *
 * <p>{@code is2faPending} is only ever true for a token verified against the
 * 2FA key, never the access one — the two are signed by separate key pairs, so
 * an access-token verification can never produce it. Kept on this one type
 * anyway rather than as two: {@code JwtAuthFilter} needs a single shape to
 * reject a challenge token presented where a full session is required, which
 * is what {@link #isFullSession()} is for.
 */
public record JwtPrincipal(
  String sub,
  String organizationId,
  boolean isSuperAdmin,
  List<String> departmentIds,
  List<String> permissionCodes,
  boolean isEmailVerified,
  boolean is2faPending
) {
  /** A caller mid-2FA-challenge has none of the rest — never treat one as authenticated. */
  public boolean isFullSession() {
    return !is2faPending;
  }

  /**
   * An agent by ticket-service's own definition: a super admin, or a holder of
   * {@code ticket.read.all} or {@code ticket.message.moderate}. It decides who
   * sees internal notes there, and who joins the agents-only rooms here.
   */
  public boolean isAgent() {
    return (
      isSuperAdmin ||
      (permissionCodes != null &&
        (permissionCodes.contains("ticket.read.all") ||
          permissionCodes.contains("ticket.message.moderate")))
    );
  }
}
