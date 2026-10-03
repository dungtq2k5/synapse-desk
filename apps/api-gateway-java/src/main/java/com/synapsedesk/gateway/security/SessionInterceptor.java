package com.synapsedesk.gateway.security;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.openapi.RouteSecurity;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * `JwtAuthGuard`, reproduced: a caller with no valid session is refused with 401
 * BEFORE the request body is bound or validated.
 *
 * <p><b>Why before.</b> Node's guards run ahead of its validation pipes, so an
 * anonymous caller who also sends a malformed body is told to sign in, not what
 * is wrong with a body they have no right to send. A handler that reads the
 * session itself does so after Spring has bound and validated the body, so
 * without this an anonymous caller got a 400 on 28 of the 80 secured routes that
 * take a body, and a validation message for a route they cannot use.
 *
 * <p><b>Which routes.</b> The ones {@link RouteSecurity} is not on: the same
 * marker that publishes {@code security: []} or a special cookie, so a route is
 * published as secured exactly when this enforces it. The one marker that is still
 * gated is {@code SESSION_OR_CHALLENGE}, which asks {@link TwoFactorEnrolmentGuard}
 * for a session or a live login challenge. A handler outside this
 * application (an actuator endpoint, the error page) is not ours to gate.
 */
@Component
public class SessionInterceptor implements HandlerInterceptor {

  private static final String OURS = "com.synapsedesk.gateway";

  private final CurrentUser currentUser;
  private final TwoFactorEnrolmentGuard enrolment;

  public SessionInterceptor(
    CurrentUser currentUser,
    TwoFactorEnrolmentGuard enrolment
  ) {
    this.currentUser = currentUser;
    this.enrolment = enrolment;
  }

  @Override
  public boolean preHandle(
    HttpServletRequest request,
    HttpServletResponse response,
    Object handler
  ) {
    if (
      !(handler instanceof HandlerMethod method) ||
      !method.getBeanType().getName().startsWith(OURS)
    ) {
      return true;
    }

    RouteSecurity marker = method.getMethodAnnotation(RouteSecurity.class);
    if (marker == null) {
      currentUser.require(request);
    } else if (marker.value() == RouteSecurity.Scheme.SESSION_OR_CHALLENGE) {
      enrolment.require(request);
    }

    return true;
  }
}
