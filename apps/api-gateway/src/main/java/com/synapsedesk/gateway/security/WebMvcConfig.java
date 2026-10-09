package com.synapsedesk.gateway.security;

import com.synapsedesk.gateway.lifecycle.OrganizationLifecycleInterceptor;
import com.synapsedesk.gateway.metrics.HttpMetricsInterceptor;
import com.synapsedesk.gateway.throttle.ThrottlerInterceptor;
import com.synapsedesk.gateway.web.EnumParameterConverters;
import com.synapsedesk.gateway.web.PathIdInterceptor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type;
import org.springframework.context.annotation.Configuration;
import org.springframework.format.FormatterRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers {@link SessionInterceptor}, {@link PermissionInterceptor} and {@link ThrottlerInterceptor} on
 * every route — `PermissionGuard`'s and `SmartThrottlerGuard`'s global scope.
 *
 * <p><b>{@code ThrottlerInterceptor} used to compile, inject and never
 * run.</b> A {@code HandlerInterceptor} is an ordinary bean until named
 * here — unlike a {@code @Component Filter}, which Boot auto-registers —
 * and this method registered {@code permissionInterceptor} alone. Every
 * route was therefore unthrottled: no limit was enforced, so no row asserting
 * a 429 could have caught it, and none did. {@code
 * ThrottlerInterceptorTest#unregisteredInterceptorNeverThrottles} pins this
 * failure mode directly, by sabotage — see its own comment.
 */
@Configuration
@ConditionalOnWebApplication(type = Type.SERVLET)
public class WebMvcConfig implements WebMvcConfigurer {

  private final SessionInterceptor sessionInterceptor;
  private final PermissionInterceptor permissionInterceptor;
  private final ThrottlerInterceptor throttlerInterceptor;
  private final HttpMetricsInterceptor httpMetricsInterceptor;
  private final OrganizationLifecycleInterceptor organizationLifecycleInterceptor;
  private final PathIdInterceptor pathIdInterceptor;

  public WebMvcConfig(
    SessionInterceptor sessionInterceptor,
    PermissionInterceptor permissionInterceptor,
    ThrottlerInterceptor throttlerInterceptor,
    HttpMetricsInterceptor httpMetricsInterceptor,
    OrganizationLifecycleInterceptor organizationLifecycleInterceptor,
    PathIdInterceptor pathIdInterceptor
  ) {
    this.sessionInterceptor = sessionInterceptor;
    this.permissionInterceptor = permissionInterceptor;
    this.throttlerInterceptor = throttlerInterceptor;
    this.httpMetricsInterceptor = httpMetricsInterceptor;
    this.organizationLifecycleInterceptor = organizationLifecycleInterceptor;
    this.pathIdInterceptor = pathIdInterceptor;
  }

  @Override
  public void addFormatters(FormatterRegistry registry) {
    EnumParameterConverters.register(registry);
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    // Throttling runs BEFORE permission checks: a caller hammering a route they
    // lack permission for still consumes the rate-limit budget rather than a
    // cheap 403 every time.
    registry.addInterceptor(throttlerInterceptor);
    // Then the session, before the permission check: an anonymous caller is told
    // to sign in before anything about the body they sent or the permission they lack.
    registry.addInterceptor(sessionInterceptor);
    registry.addInterceptor(permissionInterceptor);
    // After the permission check: a request that lacks a permission is refused
    // for THAT without the lifecycle gate asking about the tenant.
    registry.addInterceptor(organizationLifecycleInterceptor);
    // Order does not decide what is counted: a refusal a guard-equivalent makes
    // is marked ({@code GuardRefusal}) and the recorder skips marked requests,
    // whichever interceptor ran first.
    registry.addInterceptor(httpMetricsInterceptor);
    // After the metrics: a malformed id is refused for THAT, after the guards,
    // and still counted.
    registry.addInterceptor(pathIdInterceptor);
  }
}
