package com.synapsedesk.gateway.lifecycle;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.web.ApplicationRoutes;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.lang.reflect.Method;
import java.util.Optional;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * The tenant lifecycle gate for REST.
 *
 * <p>Every business route checks the owning tenant's status before dispatch. Registered
 * AFTER throttling and permissions, so a request that lacks a permission is refused for
 * THAT, without the gate ever asking about the tenant.
 *
 * <p>Three callers pass through untouched, and none of them is asked about:
 *
 * <ul>
 *   <li>a request with no full session, which has no tenant yet (login, register, the
 *       public invitation preview);
 *   <li>a Super Admin, who belongs to no tenant and must be able to act ON a frozen
 *       one, which is the whole point of them;
 *   <li>a route in the {@link OrgAccess#AUTH} category, so a member of a frozen
 *       workspace can still sign in and be told why.
 * </ul>
 *
 * <p>GraphQL is gated by {@link GraphqlLifecycleAspect}, which dispatches separately:
 * a frozen tenant that can still read through GraphQL is a suspension with a hole in
 * it.
 */
@Component
public class OrganizationLifecycleInterceptor implements HandlerInterceptor {

  private final CurrentUser currentUser;
  private final LifecyclePolicy policy;

  public OrganizationLifecycleInterceptor(
    CurrentUser currentUser,
    LifecyclePolicy policy
  ) {
    this.currentUser = currentUser;
    this.policy = policy;
  }

  @Override
  public boolean preHandle(
    HttpServletRequest request,
    HttpServletResponse response,
    Object handler
  ) {
    if (!ApplicationRoutes.isApplicationHandler(handler)) return true;

    Optional<RequestContext> caller = currentUser.read(request);
    if (caller.isEmpty()) return true;

    RequestContext context = caller.get();
    if (
      context.isSuperAdmin() ||
      context.organizationId() == null ||
      context.organizationId().isEmpty()
    ) {
      return true;
    }

    policy.require(
      context.organizationId(),
      kindOf((HandlerMethod) handler, request.getMethod())
    );

    return true;
  }

  /** The route's declared category (the method's, else its controller's), or the verb's. */
  static OrgAccess kindOf(HandlerMethod handler, String method) {
    return kindOf(handler.getMethod(), handler.getBeanType(), method);
  }

  /**
   * The same rule for any handler, a GraphQL resolver included: the method's
   * {@link OrgAccessKind}, else its class's, else the verb's.
   */
  static OrgAccess kindOf(Method handler, Class<?> type, String method) {
    OrgAccessKind declared = AnnotatedElementUtils.findMergedAnnotation(
      handler,
      OrgAccessKind.class
    );
    if (declared == null) {
      declared = AnnotatedElementUtils.findMergedAnnotation(
        type,
        OrgAccessKind.class
      );
    }

    return declared != null ? declared.value() : LifecyclePolicy.byVerb(method);
  }
}
