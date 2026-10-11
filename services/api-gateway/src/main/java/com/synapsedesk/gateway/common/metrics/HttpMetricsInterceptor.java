package com.synapsedesk.gateway.common.metrics;

import com.synapsedesk.gateway.common.web.ApplicationRoutes;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

/**
 * {@code http_requests_total} and {@code http_request_duration_seconds}.
 *
 * <p><b>Every request matched to a route is counted</b>, refused or not: a guard's
 * refusal (no cookie, no permission, rate limited) is a request like any other. This
 * interceptor is registered first, so its completion runs whichever later interceptor
 * refused. A request that matches no route, and one answered by a filter before MVC,
 * are not counted.
 *
 * <p><b>The {@code status} label is the status the client received.</b> An exception
 * no handler resolved is a 500, the answer the container gives it.
 *
 * <p><b>The {@code route} label is the path TEMPLATE, never the resolved path</b>,
 * with {@code :name} parameters ({@code /api/v1/tickets/:id}), the form every
 * existing series carries: {@code
 * /tickets/<uuid>} would mint one time series per ticket, forever, in a metric that
 * looks perfectly ordinary.
 *
 * <p>Not counted: GraphQL (not an MVC handler method), the generated
 * documentation, and the container's own error dispatch.
 */
@Component
public class HttpMetricsInterceptor implements HandlerInterceptor {

  private static final String STARTED =
    HttpMetricsInterceptor.class.getName() + ".started";

  private final GatewayMetrics metrics;

  public HttpMetricsInterceptor(GatewayMetrics metrics) {
    this.metrics = metrics;
  }

  @Override
  public boolean preHandle(
    HttpServletRequest request,
    HttpServletResponse response,
    Object handler
  ) {
    if (counts(handler)) {
      request.setAttribute(STARTED, System.nanoTime());
    }

    return true;
  }

  @Override
  public void afterCompletion(
    HttpServletRequest request,
    HttpServletResponse response,
    Object handler,
    Exception failure
  ) {
    if (
      !counts(handler) ||
      !(request.getAttribute(STARTED) instanceof Long started)
    ) {
      return;
    }

    Object pattern = request.getAttribute(
      HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE
    );

    metrics.httpRequest(
      pattern instanceof String template
        ? routeTemplate(template)
        : "unmatched",
      request.getMethod(),
      failure == null ? response.getStatus() : 500,
      Duration.ofNanos(System.nanoTime() - started)
    );
  }

  /** Whether a request answered by {@code handler} is counted: an application handler. */
  static boolean counts(Object handler) {
    return ApplicationRoutes.isApplicationHandler(handler);
  }

  /** {@code /api/v1/tickets/{id}} as the label writes it: {@code /api/v1/tickets/:id}. */
  static String routeTemplate(String pattern) {
    return pattern.replaceAll("\\{(\\w+)(?::[^}]*)?}", ":$1");
  }
}
