package com.synapsedesk.gateway.security;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.config.RuntimeProperties;
import com.synapsedesk.gateway.generated.model.CurrentUserResponseDto.PermissionCodesEnum;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Arrays;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * `PermissionGuard`, reproduced — reads {@link RequirePermission} off the
 * invoked handler and enforces it.
 *
 * <p><b>No annotation is not a bug, it is Node's own fail-open.</b>
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
  private final RuntimeProperties runtime;

  public PermissionInterceptor(CurrentUser currentUser, RuntimeProperties runtime) {
    this.currentUser = currentUser;
    this.runtime = runtime;
  }

  @Override
  public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
    if (!(handler instanceof HandlerMethod handlerMethod)) {
      return true;
    }

    RequirePermission required = handlerMethod.getMethodAnnotation(RequirePermission.class);
    if (required == null) {
      return true;
    }

    RequestContext context = currentUser.require(request);

    // Super admin bypasses permission checks — `PermissionGuard`'s own rule.
    if (context.isSuperAdmin()) {
      return true;
    }

    boolean granted =
        Arrays.stream(required.value())
            .anyMatch(code -> context.permissionCodes().contains(code.getValue()));
    if (granted) {
      return true;
    }

    boolean production = "production".equals(runtime.nodeEnv());
    throw new ResponseStatusException(
        HttpStatus.FORBIDDEN,
        production
            ? "You do not have permission to access this resource"
            : "Requires one of: "
                + Arrays.stream(required.value())
                    .map(PermissionCodesEnum::getValue)
                    .collect(Collectors.joining(", ")));
  }
}
