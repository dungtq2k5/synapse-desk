package com.synapsedesk.gateway.common.metrics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.lang.reflect.Method;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.function.HandlerFunction;
import org.springframework.web.servlet.function.ServerResponse;
import org.springframework.web.servlet.resource.ResourceHttpRequestHandler;

/**
 * What the HTTP metrics record, for which requests, under which labels: every request
 * once, under the route as a template (or a fixed label) and the status the client
 * received.
 */
class HttpMetricsFilterTest {

  static class Handlers {

    public void plain() {}
  }

  /** What MVC and the filters after this one did with a request. */
  @FunctionalInterface
  interface Downstream {
    void serve(HttpServletRequest request, HttpServletResponse response)
      throws Exception;
  }

  private MeterRegistry registry;
  private HttpMetricsFilter filter;

  @BeforeEach
  void setUp() {
    registry = new SimpleMeterRegistry();
    filter = new HttpMetricsFilter(new GatewayMetrics(registry), "/graphql");
  }

  private static HandlerMethod plain() throws Exception {
    Method method = Handlers.class.getMethod("plain");

    return new HandlerMethod(new Handlers(), method);
  }

  /** MVC mapped the request to {@code handler}, under {@code pattern}. */
  private static void mapped(
    HttpServletRequest request,
    Object handler,
    String pattern
  ) {
    request.setAttribute(
      HandlerMapping.BEST_MATCHING_HANDLER_ATTRIBUTE,
      handler
    );
    if (pattern != null) {
      request.setAttribute(
        HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE,
        pattern
      );
    }
  }

  private void serve(MockHttpServletRequest request, Downstream downstream)
    throws Exception {
    filter.doFilter(
      request,
      new MockHttpServletResponse(),
      new MockFilterChain(
        new jakarta.servlet.http.HttpServlet() {
          @Override
          protected void service(
            HttpServletRequest req,
            HttpServletResponse res
          ) throws ServletException {
            try {
              downstream.serve(req, res);
            } catch (ServletException | RuntimeException e) {
              throw e;
            } catch (Exception e) {
              throw new ServletException(e);
            }
          }
        }
      )
    );
  }

  private double count(String route, String method, String status) {
    var counter = registry
      .find(PublishedSeries.HTTP_REQUESTS)
      .tags("route", route, "method", method, "status", status)
      .counter();

    return counter == null ? 0 : counter.count();
  }

  private int recorded() {
    return registry.find(PublishedSeries.HTTP_REQUESTS).counters().size();
  }

  @Test
  void aRequestAHandlerServedIsCountedUnderItsTemplateAndTheDurationToo()
    throws Exception {
    serve(new MockHttpServletRequest("GET", "/api/v1/tickets/42"), (q, r) ->
      mapped(q, plain(), "/api/v1/tickets/{id}")
    );

    assertThat(count("/api/v1/tickets/:id", "GET", "200")).isEqualTo(1);
    assertThat(
      registry
        .find(PublishedSeries.HTTP_DURATION)
        .tags("route", "/api/v1/tickets/:id", "method", "GET", "status", "200")
        .timer()
        .count()
    ).isEqualTo(1);
  }

  @Test
  void aRefusalAfterMappingIsCountedUnderTheStatusTheClientReceived()
    throws Exception {
    serve(new MockHttpServletRequest("POST", "/api/v1/departments"), (q, r) -> {
      mapped(q, plain(), "/api/v1/departments");
      r.setStatus(401);
    });

    assertThat(count("/api/v1/departments", "POST", "401")).isEqualTo(1);
    assertThat(recorded()).isEqualTo(1);
  }

  @Test
  void anExceptionNothingResolvedIsCountedAs500AndStillThrown()
    throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest(
      "GET",
      "/api/v1/x"
    );

    assertThatThrownBy(() ->
      serve(request, (q, r) -> {
        mapped(q, plain(), "/api/v1/x");
        throw new IllegalStateException("peer down");
      })
    ).isInstanceOf(IllegalStateException.class);
    assertThat(count("/api/v1/x", "GET", "500")).isEqualTo(1);
  }

  @Test
  void aFilterRefusalBeforeMvcIsRefusedBeforeRouting() throws Exception {
    serve(new MockHttpServletRequest("POST", "/api/v1/departments"), (q, r) ->
      r.setStatus(415)
    );

    assertThat(count("refused-before-routing", "POST", "415")).isEqualTo(1);
  }

  @Test
  void aPathNoRouteMatchesIsUnmatched() throws Exception {
    serve(new MockHttpServletRequest("GET", "/api/v1/no/such"), (q, r) -> {
      mapped(q, new ResourceHttpRequestHandler(), "/**");
      r.setStatus(404);
    });

    assertThat(count("unmatched", "GET", "404")).isEqualTo(1);
    assertThat(recorded()).isEqualTo(1);
  }

  @Test
  void aHandlerThatIsNotTheApplicationsIsNotCounted() throws Exception {
    HandlerFunction<ServerResponse> routerFunction = q ->
      ServerResponse.ok().build();
    serve(new MockHttpServletRequest("GET", "/v3/api-docs"), (q, r) ->
      mapped(q, routerFunction, null)
    );

    assertThat(recorded()).isZero();
  }

  @Test
  void graphqlAndAPreflightAreNotCounted() throws Exception {
    serve(new MockHttpServletRequest("POST", "/graphql"), (q, r) -> {});
    MockHttpServletRequest preflight = new MockHttpServletRequest(
      "OPTIONS",
      "/api/v1/auth/login"
    );
    preflight.addHeader("Origin", "http://localhost:5173");
    preflight.addHeader("Access-Control-Request-Method", "POST");
    serve(preflight, (q, r) -> r.setStatus(204));

    assertThat(recorded()).isZero();
  }

  @Test
  void pathVariablesBecomeExpressParameters() {
    assertThat(
      HttpMetricsFilter.routeTemplate("/api/v1/tickets/{id}")
    ).isEqualTo("/api/v1/tickets/:id");
    assertThat(
      HttpMetricsFilter.routeTemplate("/api/v1/a/{aId}/b/{bId}")
    ).isEqualTo("/api/v1/a/:aId/b/:bId");
    assertThat(
      HttpMetricsFilter.routeTemplate("/api/v1/n/{id:[0-9]+}")
    ).isEqualTo("/api/v1/n/:id");
  }
}
