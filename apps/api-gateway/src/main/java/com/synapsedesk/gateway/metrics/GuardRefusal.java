package com.synapsedesk.gateway.metrics;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.server.ResponseStatusException;

/**
 * Marks a refusal that Node issues from a GUARD, so the request is not counted.
 *
 * <p>Node counts a request only once it reaches a handler: its interceptor runs
 * after the guards (authentication, permissions, rate limit, and the rest), so a
 * request a guard refuses never appears in {@code http_requests_total}. Java has
 * no guard layer for most of these: {@code CurrentUser.require},
 * {@code PermissionChecker}, {@code SuperAdminCheck} and the others are called from
 * inside the handler, where an interceptor cannot tell a guard's refusal from a
 * handler's own. They call {@link #refused} as they throw, which is the only way
 * the counter can mirror Node.
 *
 * <p>It matters because the series is read by alert rules and dashboards tuned to
 * Node's numbers. A gateway that counted refused requests would step the series up
 * at cutover by exactly the volume of 401s and 403s, which reads as a traffic
 * event and not as a change of meaning.
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
