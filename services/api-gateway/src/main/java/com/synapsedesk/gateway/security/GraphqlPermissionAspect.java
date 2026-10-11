package com.synapsedesk.gateway.security;

import com.synapsedesk.gateway.auth.CurrentUser;
import com.synapsedesk.gateway.auth.RequestContext;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * {@link PermissionInterceptor}'s check, for a resolver method a {@code
 * HandlerInterceptor} cannot see.
 *
 * <p>
 * <b>Spring for GraphQL invokes {@code @QueryMapping}/{@code
 * @MutationMapping}/{@code @SchemaMapping} methods directly on the bean it
 * reads from the {@code ApplicationContext}</b> — the same bean Spring AOP
 * has already wrapped in a CGLIB proxy for any other reason (there is
 * currently none, so this dependency is what CREATES the proxy). Advising
 * every {@code @RequirePermission} method, resolver or controller, is the
 * one gate; {@code HandlerInterceptor} and this aspect are two ways IN to
 * the same {@link PermissionChecker}, not two checks.
 *
 * <p>
 * The underlying request comes off {@link RequestContextHolder}, valid
 * here because every gRPC call this gateway makes is BLOCKING — the whole
 * resolver chain, and therefore this advice, runs on the one servlet thread
 * that received the POST, never hopping to a worker the way a reactive or
 * `@Async` path would.
 */
@Aspect
@Component
public class GraphqlPermissionAspect {

  private final CurrentUser currentUser;
  private final PermissionChecker checker;

  public GraphqlPermissionAspect(
    CurrentUser currentUser,
    PermissionChecker checker
  ) {
    this.currentUser = currentUser;
    this.checker = checker;
  }

  // Scoped to `*Resolver` classes, not every `@RequirePermission` method —
  // REST controllers carry the same annotation and are already covered by
  // `PermissionInterceptor`. Matching both here would run the check twice
  // for a REST route and mean two mechanisms enforce one rule, which is the
  // "one file keeps the stub" shape this plan's own §2 warns against.
  //
  // The annotation is bound as the advice's parameter, so its type is the
  // compiler's to check: a class name in the expression that stops resolving
  // makes Spring drop the advice without an error.
  @Around(
    "execution(* com.synapsedesk.gateway..*Resolver.*(..)) && @annotation(required)"
  )
  public Object enforce(
    ProceedingJoinPoint joinPoint,
    RequirePermission required
  ) throws Throwable {
    HttpServletRequest request = (
      (ServletRequestAttributes) RequestContextHolder.currentRequestAttributes()
    ).getRequest();

    RequestContext context = currentUser.require(request);
    checker.enforce(context, required);

    return joinPoint.proceed();
  }
}
