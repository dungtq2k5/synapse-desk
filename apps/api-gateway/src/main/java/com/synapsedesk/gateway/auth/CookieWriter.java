package com.synapsedesk.gateway.auth;

import com.synapsedesk.gateway.config.CookieProperties;
import com.synapsedesk.gateway.config.JwtProperties;
import com.synapsedesk.gateway.config.RuntimeProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import java.util.Optional;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/**
 * The five session cookies: how each is set and how each is cleared.
 *
 * <p>Every `set*` and `clear*` pair shares one private builder — so `httpOnly`,
 * `secure`, `sameSite` and `path` are written once rather than five times,
 * and the Set-Cookie parity rows in `auth.contract-spec.ts` are asserting a
 * SHARED path, not five independent ones.
 */
@Component
public class CookieWriter {

  private final JwtProperties jwt;
  private final CookieProperties cookie;
  private final boolean isProduction;

  public CookieWriter(
    JwtProperties jwt,
    CookieProperties cookie,
    RuntimeProperties runtime
  ) {
    this.jwt = jwt;
    this.cookie = cookie;
    this.isProduction = "production".equals(runtime.nodeEnv());
  }

  public void setAccessToken(HttpServletResponse response, String token) {
    set(response, jwt.accessName(), token, cookie.accessMaxAge());
  }

  public void setRefreshToken(HttpServletResponse response, String token) {
    set(response, jwt.refreshName(), token, cookie.refreshMaxAge());
  }

  public void setTwoFactorToken(HttpServletResponse response, String token) {
    set(response, jwt.twoFactorName(), token, cookie.twoFactorMaxAge());
  }

  public void setDeviceToken(HttpServletResponse response, String token) {
    set(response, jwt.deviceTokenName(), token, cookie.deviceMaxAge());
  }

  public void setTenantSelection(HttpServletResponse response, String token) {
    set(
      response,
      jwt.tenantSelectionName(),
      token,
      cookie.tenantSelectionMaxAge()
    );
  }

  public Optional<String> readRefreshToken(HttpServletRequest request) {
    return read(request, jwt.refreshName());
  }

  public Optional<String> readTwoFactorToken(HttpServletRequest request) {
    return read(request, jwt.twoFactorName());
  }

  public Optional<String> readTenantSelectionToken(HttpServletRequest request) {
    return read(request, jwt.tenantSelectionName());
  }

  public Optional<String> readDeviceToken(HttpServletRequest request) {
    return read(request, jwt.deviceTokenName());
  }

  /** Ends a session: every cookie a live session could be holding. */
  public void clearSession(HttpServletResponse response) {
    clear(response, jwt.accessName());
    clear(response, jwt.refreshName());
    clear(response, jwt.twoFactorName());
    clear(response, jwt.tenantSelectionName());
  }

  public void clearAccessToken(HttpServletResponse response) {
    clear(response, jwt.accessName());
  }

  public void clearRefreshToken(HttpServletResponse response) {
    clear(response, jwt.refreshName());
  }

  /**
   * The 2FA challenge cookie alone — {@code clear2faTokenCookie}, reproduced.
   * Used standalone by the second leg of login: the challenge is spent before
   * the real session cookies are set, never grouped with {@link
   * #clearSession}, which clears access/refresh/2fa/tenant-selection together
   * for an actual sign-out.
   */
  public void clearTwoFactorToken(HttpServletResponse response) {
    clear(response, jwt.twoFactorName());
  }

  public void clearTenantSelection(HttpServletResponse response) {
    clear(response, jwt.tenantSelectionName());
  }

  public void clearDeviceToken(HttpServletResponse response) {
    clear(response, jwt.deviceTokenName());
  }

  private void set(
    HttpServletResponse response,
    String name,
    String value,
    Duration maxAge
  ) {
    response.addHeader(
      "Set-Cookie",
      ResponseCookie.from(name, value)
        .httpOnly(true)
        .secure(isProduction)
        .sameSite(cookie.sameSite())
        .path("/")
        .maxAge(maxAge)
        .build()
        .toString()
    );
  }

  /**
   * A clear — empty value, expired. `Max-Age(Duration.ZERO)` is what makes
   * Spring write `Max-Age=0`, which the parity row in `auth.contract-spec.ts`
   * accepts alongside an `Expires`-only form as the same thing: a clear.
   */
  private void clear(HttpServletResponse response, String name) {
    response.addHeader(
      "Set-Cookie",
      ResponseCookie.from(name, "")
        .httpOnly(true)
        .secure(isProduction)
        .sameSite(cookie.sameSite())
        .path("/")
        .maxAge(Duration.ZERO)
        .build()
        .toString()
    );
  }

  private Optional<String> read(HttpServletRequest request, String name) {
    if (request.getCookies() == null) {
      return Optional.empty();
    }

    for (var c : request.getCookies()) {
      if (c.getName().equals(name)) {
        return Optional.of(c.getValue());
      }
    }

    return Optional.empty();
  }
}
