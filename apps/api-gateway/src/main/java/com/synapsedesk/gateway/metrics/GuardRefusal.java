package com.synapsedesk.gateway.metrics;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.server.ResponseStatusException;

/**
 * Marks a refusal issued by a GUARD, so the request is not counted.
 *
 * <p>A request is counted only once it reaches a handler, so a request a guard
 * (authentication, permissions, rate limit, and the rest) refuses never appears in
 * {@code http_requests_total}. Most of these guards are not a separate layer:
 * {@code CurrentUser.require}, {@code PermissionChecker}, {@code SuperAdminCheck}
 * and the others are called from inside the handler, where an interceptor cannot
 * tell a guard's refusal from a handler's own. They call {@link #refused} as they
 * throw, which is how the counter leaves them out.
 *
 * <p>It matters because the series is read by alert rules and dashboards tuned to
 * its current numbers. Counting refused requests would step the series up by
 * exactly the volume of 401s and 403s, which reads as a traffic event and not as a
 * change of meaning.
 */
public final class GuardRefusal {

  private static final String ATTRIBUTE =
    GuardRefusal.class.getName() + ".refused";

  private GuardRefusal() {}

  /**
   * Returns {@code refusal} after marking the current request, for
   * {@code throw GuardRefusal.refused(new ResponseStatusException(...))}. Safe with
   * no request bound, as in a unit test of the guard itself.
   */
  public static ResponseStatusException refused(
    ResponseStatusException refusal
  ) {
    RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
    if (attributes != null) {
      attributes.setAttribute(
        ATTRIBUTE,
        Boolean.TRUE,
        RequestAttributes.SCOPE_REQUEST
      );
    }

    return refusal;
  }

  static boolean wasRefused(HttpServletRequest request) {
    return request.getAttribute(ATTRIBUTE) != null;
  }
}
