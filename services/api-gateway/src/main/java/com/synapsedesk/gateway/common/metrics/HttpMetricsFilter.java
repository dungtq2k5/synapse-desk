package com.synapsedesk.gateway.common.metrics;

import com.synapsedesk.gateway.common.web.ApplicationRoutes;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.cors.CorsUtils;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.resource.ResourceHttpRequestHandler;

/**
 * {@code http_requests_total} and {@code http_request_duration_seconds}, for every
 * request.
 *
 * <p>The first filter, so it sees every request: one a handler served or threw from,
 * one an interceptor refused (session, permission, throttle, lifecycle), and one a
 * later filter answered before MVC (origin, Content-Type, size). It records once the
 * chain returns, so {@code status} is the status the client received; an exception
 * nothing resolved is a 500, the answer the container gives it.
 *
 * <ul>
 *   <li><b>{@code route} is the path TEMPLATE</b>, with {@code :name} parameters
 *       ({@code /api/v1/tickets/:id}): {@code /tickets/<uuid>} would mint one series
 *       per ticket, forever. A request no handler matched gets a fixed label:
 *       {@code unmatched} for a 404, {@code refused-before-routing} for a filter's
 *       refusal (it may have targeted a real route).
 *   <li><b>Not counted:</b> GraphQL (its errors ride inside a 200, so this series
 *       can't measure them), CORS preflights (the browser asking, not a call), and
 *       the generated documentation. A request the client aborted reaches here like
 *       any other, so it is counted under the status the response carried.
 * </ul>
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class HttpMetricsFilter extends OncePerRequestFilter {

  static final String UNMATCHED = "unmatched";
  static final String REFUSED_BEFORE_ROUTING = "refused-before-routing";

  private final GatewayMetrics metrics;
  private final String graphqlPath;

  public HttpMetricsFilter(
    GatewayMetrics metrics,
    @Value("${spring.graphql.http.path:/graphql}") String graphqlPath
  ) {
    this.metrics = metrics;
    this.graphqlPath = graphqlPath;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return (
      CorsUtils.isPreFlightRequest(request) ||
      graphqlPath.equals(request.getRequestURI())
    );
  }

  @Override
  protected void doFilterInternal(
    HttpServletRequest request,
    HttpServletResponse response,
    FilterChain chain
  ) throws ServletException, IOException {
    long started = System.nanoTime();
    boolean failed = true;
    try {
      chain.doFilter(request, response);
      failed = false;
    } finally {
      record(request, failed ? 500 : response.getStatus(), started);
    }
  }

  private void record(HttpServletRequest request, int status, long started) {
    Object handler = request.getAttribute(
      HandlerMapping.BEST_MATCHING_HANDLER_ATTRIBUTE
    );
    String route;
    if (ApplicationRoutes.isApplicationHandler(handler)) {
      Object pattern = request.getAttribute(
        HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE
      );
      route =
        pattern instanceof String template
          ? routeTemplate(template)
          : UNMATCHED;
    } else if (
      handler == null || handler instanceof ResourceHttpRequestHandler
    ) {
      // No handler of the application's: MVC never mapped it (a filter refused
      // it), or only the static-resource fallback did (no route, a 404).
      route = status == 404 ? UNMATCHED : REFUSED_BEFORE_ROUTING;
    } else {
      // A handler that isn't the application's: the generated documentation.
      return;
    }

    metrics.httpRequest(
      route,
      request.getMethod(),
      status,
      Duration.ofNanos(System.nanoTime() - started)
    );
  }

  /** {@code /api/v1/tickets/{id}} as the label writes it: {@code /api/v1/tickets/:id}. */
  static String routeTemplate(String pattern) {
    return pattern.replaceAll("\\{(\\w+)(?::[^}]*)?}", ":$1");
  }
}
