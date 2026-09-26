package com.synapsedesk.gateway.auth;

import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Component;

import com.synapsedesk.gateway.config.JwtProperties;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Reads the access cookie and verifies it — the Java `@CurrentUser()` /
 * `@CurrentOrigin()` pair, and `GuestGuard`'s own read, in one place.
 *
 * <p>A plain component rather than a Spring Security principal: nothing else
 * in this skeleton needs the broader authentication machinery, and a route
 * that requires a session calls {@link #require} and gets a 401 — the same
 * shape {@code @CurrentUser()} throwing gives on the Node side, just without
 * a decorator to hang it on.
 */
@Component
public class CurrentUser {

  private final JwtVerifier verifier;
  private final JwtProperties jwt;

  public CurrentUser(JwtVerifier verifier, JwtProperties jwt) {
    this.verifier = verifier;
    this.jwt = jwt;
  }

  /** `{ ip, userAgent }` — no guard needed, provenance exists for anonymous callers too. */
  public RequestOrigin origin(HttpServletRequest request) {
    String userAgent = request.getHeader("user-agent");

    return new RequestOrigin(
        request.getRemoteAddr() == null ? "" : request.getRemoteAddr(),
        userAgent == null ? "" : userAgent);
  }

  /** The access cookie, verified — empty if absent, invalid, expired, or a 2FA challenge. */
  public Optional<RequestContext> read(HttpServletRequest request) {
    return accessToken(request)
        .flatMap(verifier::verifyAccess)
        // FIXME Null type safety: parameter 'this' provided via method descriptor Predicate<JwtPrincipal>.test(JwtPrincipal) needs unchecked conversion to conform to '@Nonnull JwtPrincipal'
        .filter(JwtPrincipal::isFullSession)
        .map(principal -> toContext(principal, origin(request)));
  }

  /** Throws 401 with the Node message if the caller has no valid full session. */
  public RequestContext require(HttpServletRequest request) {
    return read(request)
        .orElseThrow(
            () ->
                new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.UNAUTHORIZED, "Unauthorized"));
  }

  /** Cryptographic validity only — for `GuestCheck`, which does not care WHO. */
  boolean isValidAccessToken(String token) {
    return verifier.verifyAccess(token).isPresent();
  }

  /**
   * The caller's id, VERIFIED but not required to be a full session —
   * `SmartThrottlerGuard.subjectFromToken`, reproduced. Deliberately not
   * {@link #read}: the throttler's tracker keys a 2FA-pending caller by their
   * token's `sub` too, same as Node does, since {@code verifyAccess} rejects a
   * 2FA-challenge token by signature (separate key pair) without needing the
   * {@code isFullSession} filter {@link #read} applies for route access.
   */
  public Optional<String> verifiedSubject(HttpServletRequest request) {
    // FIXME Null type safety: parameter 'this' provided via method descriptor Function<JwtPrincipal,String>.apply(JwtPrincipal) needs unchecked conversion to conform to '@Nonnull JwtPrincipal'
    return accessToken(request).flatMap(verifier::verifyAccess).map(JwtPrincipal::sub);
  }

  Optional<String> accessToken(HttpServletRequest request) {
    if (request.getCookies() == null) {
      return Optional.empty();
    }

    for (var cookie : request.getCookies()) {
      if (cookie.getName().equals(jwt.accessName())) {
        return Optional.of(cookie.getValue());
      }
    }

    return Optional.empty();
  }

  private RequestContext toContext(JwtPrincipal principal, RequestOrigin origin) {
    return new RequestContext(
        principal.sub() == null ? "" : principal.sub(),
        principal.organizationId(),
        principal.isSuperAdmin(),
        principal.departmentIds() == null ? List.of() : principal.departmentIds(),
        principal.permissionCodes() == null ? List.of() : principal.permissionCodes(),
        principal.isEmailVerified(),
        origin.ip(),
        origin.userAgent());
  }
}
