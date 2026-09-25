package com.synapsedesk.gateway.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * `GuestGuard`, reproduced: blocks `register`/`login`/`login/tenant`/`google`
 * for a caller who already holds a LIVE session.
 *
 * <p><b>Only the access token is checked</b>, and only its cryptographic
 * validity — presence alone is not enough, and neither is any other cookie.
 * See `guest.guard.ts` for why the refresh and device-token cookies are
 * deliberately not consulted: this is a UX guard, not a security control, so
 * failing open on any doubt is correct.
 */
@Component
public class GuestCheck {

  private final CurrentUser currentUser;

  public GuestCheck(CurrentUser currentUser) {
    this.currentUser = currentUser;
  }

  /**
   * Passes through silently unless a CRYPTOGRAPHICALLY VALID access token is
   * present — an absent, expired or tampered one lets the request continue so
   * the route can overwrite the cookie with a fresh one.
   */
  public void requireNoActiveSession(HttpServletRequest request) {
    boolean hasValidToken =
        currentUser.accessToken(request).map(currentUser::isValidAccessToken).orElse(false);

    if (hasValidToken) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "You are already logged in with an active session.");
    }
  }
}
