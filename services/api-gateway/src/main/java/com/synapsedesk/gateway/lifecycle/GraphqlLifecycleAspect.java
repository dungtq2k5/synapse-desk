package com.synapsedesk.gateway.lifecycle;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Optional;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;
import org.springframework.util.ClassUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * {@link OrganizationLifecycleInterceptor}'s check, for the GraphQL resolvers a
 * {@code HandlerInterceptor} cannot see.
 *
 * <p>Spring for GraphQL invokes the mapped resolver methods directly, so the servlet
 * interceptor never runs for them. This is a second way IN to the same
 * {@link LifecyclePolicy}, not a second check, as {@code GraphqlPermissionAspect} is
 * for permissions. The refusal is a GraphQL error carrying {@code FORBIDDEN}, not an
 * HTTP 403.
 *
 * <p>Every resolver is gated except {@code VersionResolver}, which is public.
 * GraphQL travels over POST, so a gated operation is a WRITE: a past-due-suspended
 * tenant (read-only) is refused here even for a query.
 */
@Aspect
@Component
public class GraphqlLifecycleAspect {

  private final CurrentUser currentUser;
  private final LifecyclePolicy policy;

  public GraphqlLifecycleAspect(
    CurrentUser currentUser,
    LifecyclePolicy policy
  ) {
    this.currentUser = currentUser;
    this.policy = policy;
  }

  // No class of this gateway is named in the expression: a name that stops
  // resolving makes Spring drop the advice without an error. A resolver is
  // exempted the way a route is, with `@OrgAccessKind(OrgAccess.AUTH)`.
  @Around(
    "execution(* com.synapsedesk.gateway..*Resolver.*(..)) " +
      "&& (@annotation(org.springframework.graphql.data.method.annotation.QueryMapping) " +
      "|| @annotation(org.springframework.graphql.data.method.annotation.MutationMapping) " +
      "|| @annotation(org.springframework.graphql.data.method.annotation.SchemaMapping))"
  )
  public Object gate(ProceedingJoinPoint joinPoint) throws Throwable {
    var attributes = RequestContextHolder.getRequestAttributes();
    if (attributes instanceof ServletRequestAttributes servlet) {
      HttpServletRequest request = servlet.getRequest();
      OrgAccess kind = OrganizationLifecycleInterceptor.kindOf(
        ((MethodSignature) joinPoint.getSignature()).getMethod(),
        ClassUtils.getUserClass(joinPoint.getTarget()),
        request.getMethod()
      );
      if (kind == OrgAccess.AUTH) return joinPoint.proceed();

      Optional<RequestContext> caller = currentUser.read(request);

      if (
        caller.isPresent() &&
        !caller.get().isSuperAdmin() &&
        caller.get().organizationId() != null &&
        !caller.get().organizationId().isEmpty()
      ) {
        policy.require(caller.get().organizationId(), kind);
      }
    }

    return joinPoint.proceed();
  }
}
