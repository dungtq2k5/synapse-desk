package com.synapsedesk.gateway.security;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * `PermissionGuard`, reproduced — reads {@link RequirePermission} off the
 * invoked handler and enforces it.
 *
 * <p>
 * <b>No annotation is not a bug, it is Node's own fail-open.</b>
 * {@code PermissionGuard.canActivate} returns {@code true} immediately when
 * `@RequirePermission` metadata is absent — correct for a caller-scoped route
 * like `NotificationsApi`, wrong for one that forgot the annotation. This
 * class makes the SAME choice for the SAME reason: an unannotated method is
 * open, and the guard against forgetting the annotation on a route that needs
 * one is {@code PermissionCoverageTest} (Java) / the coverage check in the
 * contract harness (Node), not a stricter default here.
 */
@Component
public class PermissionInterceptor implements HandlerInterceptor {

  private final CurrentUser currentUser;
  private final PermissionChecker checker;

  public PermissionInterceptor(
    CurrentUser currentUser,
    PermissionChecker checker
  ) {
    this.currentUser = currentUser;
    this.checker = checker;
  }

  @Override
  public boolean preHandle(
    HttpServletRequest request,
    HttpServletResponse response,
    Object handler
  ) {
    if (!(handler instanceof HandlerMethod handlerMethod)) {
      return true;
    }

    RequirePermission required = handlerMethod.getMethodAnnotation(
      RequirePermission.class
    );
    if (required == null) {
      return true;
    }

    RequestContext context = currentUser.require(request);
    checker.enforce(context, required);

    return true;
  }
}
