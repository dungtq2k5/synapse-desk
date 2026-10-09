package com.synapsedesk.gateway.lifecycle;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Optional;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;
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

  @Around(
    "execution(* com.synapsedesk.gateway..*Resolver.*(..)) " +
      "&& !within(com.synapsedesk.gateway.graphql.VersionResolver) " +
      "&& (@annotation(org.springframework.graphql.data.method.annotation.QueryMapping) " +
      "|| @annotation(org.springframework.graphql.data.method.annotation.MutationMapping) " +
      "|| @annotation(org.springframework.graphql.data.method.annotation.SchemaMapping))"
  )
  public Object gate(ProceedingJoinPoint joinPoint) throws Throwable {
    var attributes = RequestContextHolder.getRequestAttributes();
    if (attributes instanceof ServletRequestAttributes servlet) {
      HttpServletRequest request = servlet.getRequest();
      Optional<RequestContext> caller = currentUser.read(request);

      if (
        caller.isPresent() &&
        !caller.get().isSuperAdmin() &&
        caller.get().organizationId() != null &&
        !caller.get().organizationId().isEmpty()
      ) {
        policy.require(
          caller.get().organizationId(),
          LifecyclePolicy.byVerb(request.getMethod())
        );
      }
    }

    return joinPoint.proceed();
  }
}
