package com.synapsedesk.gateway.common.security;

import com.synapsedesk.gateway.common.auth.CookieWriter;
import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.JwtPrincipal;
import com.synapsedesk.gateway.common.auth.JwtVerifier;
import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.auth.RequestOrigin;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * The 2FA enrolment check: a full session first, then a verified 2FA-challenge
 * cookie, and a 401 naming both doors if neither holds.
 *
 * <p>Used twice, on purpose: by {@link SessionInterceptor}, so the refusal comes
 * BEFORE the body is bound, and by the handlers, which need
 * to know WHO enrols. The full session is tried first, so an ordinary voluntary
 * enrolment keeps its own error shape.
 */
@Component
public class TwoFactorEnrolmentGuard {

  private static final String ENROLMENT_REFUSED =
    "Enrolling in two-factor authentication requires a valid session or a live login challenge";

  private final CurrentUser currentUser;
  private final CookieWriter cookies;
  private final JwtVerifier verifier;

  public TwoFactorEnrolmentGuard(
    CurrentUser currentUser,
    CookieWriter cookies,
    JwtVerifier verifier
  ) {
    this.currentUser = currentUser;
    this.cookies = cookies;
    this.verifier = verifier;
  }

  /** `EnrolleeContext` — only what a full session and a mid-challenge caller share. */
  public record Enrollee(String sub, RequestOrigin origin) {}

  public Enrollee require(HttpServletRequest request) {
    Optional<RequestContext> full = currentUser.read(request);
    if (full.isPresent()) {
      return new Enrollee(full.get().sub(), full.get().origin());
    }

    Optional<JwtPrincipal> challenge = cookies
      .readTwoFactorToken(request)
      .flatMap(verifier::verifyTwoFactor);
    if (challenge.isPresent()) {
      return new Enrollee(challenge.get().sub(), currentUser.origin(request));
    }

    throw new ResponseStatusException(
      HttpStatus.UNAUTHORIZED,
      ENROLMENT_REFUSED
    );
  }
}
