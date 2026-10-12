package com.synapsedesk.gateway.common.auth;

import com.synapsedesk.gateway.common.config.JwtProperties;
import com.synapsedesk.gateway.common.web.ClientIp;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Reads the access cookie and verifies it: the caller's identity, their request
 * origin, and the guest check's token read, in one place.
 *
 * <p>A plain component rather than a Spring Security principal: nothing else
 * in this skeleton needs the broader authentication machinery, and a route
 * that requires a session calls {@link #require} and gets a 401.
 */
@Component
public class CurrentUser {

  private final JwtVerifier verifier;
  private final JwtProperties jwt;

  public CurrentUser(JwtVerifier verifier, JwtProperties jwt) {
    this.verifier = verifier;
    this.jwt = jwt;
  }

  /**
   * `{ ip, userAgent }` — no guard needed, provenance exists for anonymous callers too.
   * The IP is {@link ClientIp}'s, the same one the throttle keys on.
   */
  public RequestOrigin origin(HttpServletRequest request) {
    String userAgent = request.getHeader("user-agent");

    return new RequestOrigin(
      ClientIp.of(
        request.getHeader("X-Forwarded-For"),
        request.getRemoteAddr()
      ),
      userAgent == null ? "" : userAgent
    );
  }

  /** The access cookie, verified — empty if absent, invalid, expired, or a 2FA challenge. */
  public Optional<RequestContext> read(HttpServletRequest request) {
    return accessToken(request)
      .flatMap(verifier::verifyAccess)
      .filter(JwtPrincipal::isFullSession)
      .map(principal -> toContext(principal, origin(request)));
  }

  /** Throws 401 {@code "Unauthorized"} if the caller has no valid full session. */
  public RequestContext require(HttpServletRequest request) {
    return read(request).orElseThrow(() ->
      new org.springframework.web.server.ResponseStatusException(
        org.springframework.http.HttpStatus.UNAUTHORIZED,
        "Unauthorized"
      )
    );
  }

  /** Cryptographic validity only — for `GuestCheck`, which does not care WHO. */
  boolean isValidAccessToken(String token) {
    return verifier.verifyAccess(token).isPresent();
  }

  /**
   * The caller's id, VERIFIED but not required to be a full session — the
   * throttler's tracker key. Deliberately not {@link #read}: {@code verifyAccess}
   * already rejects a 2FA-challenge token by signature (separate key pair), so
   * the {@code isFullSession} filter {@link #read} applies for route access is
   * not needed to key a caller by their token's `sub`.
   */
  public Optional<String> verifiedSubject(HttpServletRequest request) {
    return accessToken(request)
      .flatMap(verifier::verifyAccess)
      .map(JwtPrincipal::sub);
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

  private RequestContext toContext(
    JwtPrincipal principal,
    RequestOrigin origin
  ) {
    return new RequestContext(
      principal.sub() == null ? "" : principal.sub(),
      principal.organizationId(),
      principal.isSuperAdmin(),
      principal.departmentIds() == null ? List.of() : principal.departmentIds(),
      principal.permissionCodes() == null
        ? List.of()
        : principal.permissionCodes(),
      principal.isEmailVerified(),
      origin.ip(),
      origin.userAgent()
    );
  }
}
