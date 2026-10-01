package com.synapsedesk.gateway.metrics;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

/**
 * {@code http_requests_total} and {@code http_request_duration_seconds}, recorded
 * the way Node's {@code HttpMetricsInterceptor} records them — including the parts
 * that look like defects, because the series is read by dashboards and alert rules
 * tuned to Node's numbers.
 *
 * <p><b>Counted only once a request reaches a handler.</b> Node's interceptor runs
 * after its guards, so a request a guard refuses (no cookie, no permission, rate
 * limited), a request that matches no route, and a request answered by a filter are
 * not counted. This interceptor is registered last, after throttling and
 * permissions, so those never reach it; the guards Java runs inside handlers mark
 * their refusal ({@link GuardRefusal}) and are skipped. A handler's OWN refusal (a
 * wrong password, a 404 from a peer) is counted, as in Node.
 *
 * <p><b>The {@code status} label is the route's DECLARED success status, never the
 * outcome.</b> Node reads {@code res.statusCode} before Nest applies the real status
 * and runs the exception filter, so a request the client sees as 404, 503 or 400 is
 * counted as 200 (a {@code GET}) or 201 (a {@code POST}). Measured, not assumed: the
 * label cannot show an error rate in Node, and mirroring it keeps Java equally blind
 * rather than stepping the series at cutover. Whether it SHOULD carry the outcome is
 * a real metrics decision, to be made deliberately with the dashboards updated in
 * the same change. The declared status is {@code @ResponseStatus}, else 200.
 *
 * <p><b>The {@code route} label is the path TEMPLATE, never the resolved path</b>,
 * written as Express writes it ({@code /api/v1/tickets/:id}): {@code
 * /tickets/<uuid>} would mint one time series per ticket, forever, in a metric that
 * looks perfectly ordinary.
 *
 * <p>Not counted, as in Node: GraphQL (not an MVC handler method), the generated
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
      !(request.getAttribute(STARTED) instanceof Long started) ||
      GuardRefusal.wasRefused(request)
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
      declaredStatus((HandlerMethod) handler).value(),
      Duration.ofNanos(System.nanoTime() - started)
    );
  }

  /** Whether a request answered by {@code handler} is one Node would count. */
  static boolean counts(Object handler) {
    if (!(handler instanceof HandlerMethod method)) return false;

    String bean = method.getBeanType().getName();

    return (
      !bean.startsWith("org.springdoc.") && !bean.contains("ErrorController")
    );
  }

  /** {@code /api/v1/tickets/{id}} as Express labels it: {@code /api/v1/tickets/:id}. */
  static String routeTemplate(String pattern) {
    return pattern.replaceAll("\\{(\\w+)(?::[^}]*)?}", ":$1");
  }

  /** What the framework answers a SUCCESSFUL call with: {@code @ResponseStatus}, else 200. */
  static HttpStatus declaredStatus(HandlerMethod handler) {
    ResponseStatus declared = AnnotatedElementUtils.findMergedAnnotation(
      handler.getMethod(),
      ResponseStatus.class
    );
    if (declared == null) {
      declared = AnnotatedElementUtils.findMergedAnnotation(
        handler.getBeanType(),
        ResponseStatus.class
      );
    }

    return declared == null ? HttpStatus.OK : declared.code();
  }
}
