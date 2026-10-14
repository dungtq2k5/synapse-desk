package com.synapsedesk.gateway.common.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Blocks `register`/`login`/`login/tenant`/`google` for a caller who already
 * holds a LIVE session.
 *
 * <p><b>Only the access token is checked</b>: that it verifies and its
 * session isn't revoked — presence alone is not enough, and neither is any
 * other cookie. A revoked session's device signs in again.
 * The refresh and device-token cookies are deliberately not consulted: this
 * is a UX guard, not a security control, so failing open on any doubt is
 * correct.
 */
@Component
public class GuestCheck {

  private final CurrentUser currentUser;

  public GuestCheck(CurrentUser currentUser) {
    this.currentUser = currentUser;
  }

  /**
   * Passes through silently unless a live access token is present — an
   * absent, expired, tampered or revoked one lets the request continue so the
   * route can overwrite the cookie with a fresh one.
   */
  public void requireNoActiveSession(HttpServletRequest request) {
    boolean hasValidToken = currentUser
      .accessToken(request)
      .map(currentUser::isValidAccessToken)
      .orElse(false);

    if (hasValidToken) {
      throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "You are already logged in with an active session."
      );
    }
  }
}
