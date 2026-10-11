package com.synapsedesk.gateway.common.metrics;

import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.lang.reflect.Method;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerMapping;

/**
 * What the HTTP metrics record, for which requests, under which labels.
 *
 * <p>Each rule is pinned: every request matched to a route is counted, refused or
 * not, under the route as a template and the status the client received.
 */
class HttpMetricsInterceptorTest {

  static class Handlers {

    public void plain() {}

    @ResponseStatus(HttpStatus.CREATED)
    public void created() {}
  }

  /** Named like Boot's container error controller, whose dispatch is not counted. */
  static class BasicErrorController {

    public void error() {}
  }

  private MeterRegistry registry;
  private HttpMetricsInterceptor interceptor;

  @BeforeEach
  void setUp() {
    registry = new SimpleMeterRegistry();
    interceptor = new HttpMetricsInterceptor(new GatewayMetrics(registry));
  }

  @AfterEach
  void tearDown() {
    RequestContextHolder.resetRequestAttributes();
  }

  private static HandlerMethod handler(Class<?> type, String name)
    throws Exception {
    Method method = type.getMethod(name);

    return new HandlerMethod(
      type.getDeclaredConstructor().newInstance(),
      method
    );
  }

  private static MockHttpServletRequest request(String method, String pattern) {
    MockHttpServletRequest request = new MockHttpServletRequest(
      method,
      "/resolved/path"
    );
    if (pattern != null) {
      request.setAttribute(
        HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE,
        pattern
      );
    }

    return request;
  }

  /** Runs a request through the interceptor the way MVC does. */
  private void serve(
    MockHttpServletRequest request,
    Object handler,
    Exception failure
  ) {
    MockHttpServletResponse response = new MockHttpServletResponse();
    interceptor.preHandle(request, response, handler);
    interceptor.afterCompletion(request, response, handler, failure);
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

  // ------------------------------------------------------------ what is counted

  @Test
  void aRequestThatReachesAHandlerIsCountedUnderRouteMethodAndStatus()
    throws Exception {
    serve(
      request("GET", "/api/v1/tickets/{id}"),
      handler(Handlers.class, "plain"),
      null
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
  void theRouteIsTheTemplateNeverTheResolvedPath() throws Exception {
    serve(
      request("GET", "/api/v1/tickets/{id}"),
      handler(Handlers.class, "plain"),
      null
    );

    assertThat(
      registry.find(PublishedSeries.HTTP_REQUESTS).counters()
    ).allSatisfy(counter ->
      assertThat(counter.getId().getTag("route")).doesNotContain("resolved")
    );
  }

  @Test
  void aRequestThatMatchedNoRouteIsNotCountedBecauseNoHandlerWasReached() {
    serve(request("GET", null), new Object(), null);

    assertThat(recorded()).isZero();
  }

  @Test
  void aHandlerThatIsNotAnMvcMethodIsNotCounted() {
    // A router function, which is how GraphQL is served: GraphQL is not counted.
    serve(request("POST", "/graphql"), (Runnable) () -> {}, null);

    assertThat(recorded()).isZero();
  }

  @Test
  void theGeneratedDocumentationIsNotCounted() throws Exception {
    Class<?> docs = Class.forName(
      "org.springdoc.webmvc.api.OpenApiWebMvcResource"
    );
    Method any = docs.getMethods()[0];
    HandlerMethod handler = new HandlerMethod(
      org.mockito.Mockito.mock(docs),
      any
    );

    serve(request("GET", "/v3/api-docs"), handler, null);

    assertThat(recorded()).isZero();
  }

  @Test
  void theContainersOwnErrorDispatchIsNotCounted() throws Exception {
    serve(
      request("GET", "/error"),
      handler(BasicErrorController.class, "error"),
      null
    );

    assertThat(recorded()).isZero();
  }

  @Test
  void anExceptionNoHandlerResolvedIsCountedAs500() throws Exception {
    serve(
      request("GET", "/api/v1/x"),
      handler(Handlers.class, "plain"),
      new IllegalStateException("peer down")
    );

    assertThat(count("/api/v1/x", "GET", "500")).isEqualTo(1);
  }

  @Test
  void afterCompletionWithoutAPreHandleRecordsNothing() throws Exception {
    // MVC calls afterCompletion only after this preHandle; with no start time
    // there is nothing to record.
    MockHttpServletRequest request = request("GET", "/api/v1/x");

    interceptor.afterCompletion(
      request,
      new MockHttpServletResponse(),
      handler(Handlers.class, "plain"),
      null
    );

    assertThat(recorded()).isZero();
  }

  // ------------------------------------------------------------ the status

  @Test
  void aRefusedRequestIsCountedUnderTheStatusTheClientReceived()
    throws Exception {
    MockHttpServletRequest request = request("POST", "/api/v1/departments");
    MockHttpServletResponse response = new MockHttpServletResponse();
    interceptor.preHandle(
      request,
      response,
      handler(Handlers.class, "created")
    );
    // A guard or the handler refused it, and the exception handler wrote the 401.
    response.setStatus(401);
    interceptor.afterCompletion(
      request,
      response,
      handler(Handlers.class, "created"),
      null
    );

    assertThat(count("/api/v1/departments", "POST", "401")).isEqualTo(1);
    assertThat(count("/api/v1/departments", "POST", "201")).isZero();
  }

  // ------------------------------------------------------------ the template

  @Test
  void pathVariablesBecomeExpressParameters() {
    assertThat(
      HttpMetricsInterceptor.routeTemplate("/api/v1/tickets/{id}")
    ).isEqualTo("/api/v1/tickets/:id");
    assertThat(
      HttpMetricsInterceptor.routeTemplate("/api/v1/a/{aId}/b/{bId}")
    ).isEqualTo("/api/v1/a/:aId/b/:bId");
    assertThat(
      HttpMetricsInterceptor.routeTemplate("/api/v1/n/{id:[0-9]+}")
    ).isEqualTo("/api/v1/n/:id");
    assertThat(HttpMetricsInterceptor.routeTemplate("/health/ready")).isEqualTo(
      "/health/ready"
    );
  }
}
