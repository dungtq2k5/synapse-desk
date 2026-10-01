package com.synapsedesk.gateway.security;

import com.synapsedesk.gateway.metrics.HttpMetricsInterceptor;
import com.synapsedesk.gateway.throttle.ThrottlerInterceptor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers {@link PermissionInterceptor} and {@link ThrottlerInterceptor} on
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

  private final PermissionInterceptor permissionInterceptor;
  private final ThrottlerInterceptor throttlerInterceptor;
  private final HttpMetricsInterceptor httpMetricsInterceptor;

  public WebMvcConfig(
    PermissionInterceptor permissionInterceptor,
    ThrottlerInterceptor throttlerInterceptor,
    HttpMetricsInterceptor httpMetricsInterceptor
  ) {
    this.permissionInterceptor = permissionInterceptor;
    this.throttlerInterceptor = throttlerInterceptor;
    this.httpMetricsInterceptor = httpMetricsInterceptor;
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    // Throttling runs BEFORE permission checks — Node's guard order
    // (`SmartThrottlerGuard` precedes `PermissionGuard` in `@UseGuards`), and
    // the one that matters: a caller hammering a route they lack permission
    // for still consumes the rate-limit budget rather than a cheap 403 every
    // time.
    registry.addInterceptor(throttlerInterceptor);
    registry.addInterceptor(permissionInterceptor);
    // LAST: a request a guard refused above never reaches it, which is what makes
    // the counter count only requests that reach a handler, as Node's does.
    registry.addInterceptor(httpMetricsInterceptor);
  }
}
