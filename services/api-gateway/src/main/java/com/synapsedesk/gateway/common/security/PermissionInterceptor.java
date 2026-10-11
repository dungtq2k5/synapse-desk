package com.synapsedesk.gateway.common.security;

import com.synapsedesk.gateway.common.auth.CurrentUser;
import com.synapsedesk.gateway.common.auth.RequestContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Reads {@link RequirePermission} off the invoked handler and enforces it.
 *
 * <p>
 * <b>No annotation is not a bug, it is a deliberate fail-open.</b>
 * An unannotated method is open — correct for a caller-scoped route like
 * `NotificationsApi`, wrong for one that forgot the annotation. The guard
 * against forgetting it on a route that needs one is the permission registry
 * check, `test/gateway-contract/permission-coverage.contract-spec.ts`, not a
 * stricter default here.
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
