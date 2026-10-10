package com.synapsedesk.gateway.security;

import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.config.RuntimeProperties;
import com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum;
import java.util.Arrays;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * `PermissionGuard.canActivate`'s check, factored out of {@link
 * PermissionInterceptor} so {@link GraphqlPermissionAspect} enforces the
 * exact same rule from a transport `HandlerInterceptor` cannot see.
 */
@Component
public class PermissionChecker {

  private final RuntimeProperties runtime;

  public PermissionChecker(RuntimeProperties runtime) {
    this.runtime = runtime;
  }

  /**
   * Throws 403 unless the caller is super admin or holds one of the required
   * codes.
   */
  public void enforce(RequestContext context, RequirePermission required) {
    if (context.isSuperAdmin()) {
      return;
    }

    boolean granted = Arrays.stream(required.value()).anyMatch(code ->
      context.permissionCodes().contains(code.getValue())
    );
    if (granted) {
      return;
    }

    boolean production = "production".equals(runtime.nodeEnv());
    throw new ResponseStatusException(
      HttpStatus.FORBIDDEN,
      production
        ? "You do not have permission to access this resource"
        : "Requires one of: " +
            Arrays.stream(required.value())
              .map(PermissionCodesEnum::getValue)
              .collect(Collectors.joining(", "))
    );
  }
}
