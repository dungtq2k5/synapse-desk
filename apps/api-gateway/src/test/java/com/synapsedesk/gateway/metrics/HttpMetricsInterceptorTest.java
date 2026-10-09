package com.synapsedesk.gateway.metrics;

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
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerMapping;

/**
 * What the HTTP metrics record, for which requests, under which labels.
 *
 * <p>The series is read by alert rules and dashboards tuned to its current numbers,
 * so each rule here is pinned: counted only once a handler is reached, the route as
 * a template, the DECLARED status and never the outcome.
 */
class HttpMetricsInterceptorTest {

  /** A handler of each declared status. */
  static class Handlers {

    public void plain() {}

    @ResponseStatus(HttpStatus.CREATED)
    public void created() {}

    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void gone() {}
  }

  @ResponseStatus(HttpStatus.ACCEPTED)
  static class AcceptedController {

    public void anything() {}
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
  void aHandlerThatThrewIsStillCounted() throws Exception {
    serve(
      request("GET", "/api/v1/x"),
      handler(Handlers.class, "plain"),
      new IllegalStateException("peer down")
    );

    assertThat(count("/api/v1/x", "GET", "200")).isEqualTo(1);
  }

  @Test
  void afterCompletionWithoutAPreHandleRecordsNothing() throws Exception {
    // A request an earlier interceptor refused: MVC never called preHandle here.
    MockHttpServletRequest request = request("GET", "/api/v1/x");

    interceptor.afterCompletion(
      request,
      new MockHttpServletResponse(),
      handler(Handlers.class, "plain"),
      null
    );

    assertThat(recorded()).isZero();
  }

  // ------------------------------------------------------------ guard refusals

  @Test
  void aRequestAGuardRefusedIsNotCounted() throws Exception {
    MockHttpServletRequest request = request("GET", "/api/v1/x");
    RequestContextHolder.setRequestAttributes(
      new ServletRequestAttributes(request)
    );
    MockHttpServletResponse response = new MockHttpServletResponse();
    interceptor.preHandle(request, response, handler(Handlers.class, "plain"));

    // Java runs most guards inside the handler: the refusal marks the request.
    GuardRefusal.refused(new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    interceptor.afterCompletion(
      request,
      response,
      handler(Handlers.class, "plain"),
      null
    );

    assertThat(recorded()).isZero();
  }

  @Test
  void aHandlersOwnRefusalIsNotMarkedAndIsCounted() throws Exception {
    serve(
      request("POST", "/api/v1/auth/login"),
      handler(Handlers.class, "plain"),
      new ResponseStatusException(HttpStatus.UNAUTHORIZED, "wrong password")
    );

    assertThat(count("/api/v1/auth/login", "POST", "200")).isEqualTo(1);
  }

  @Test
  void markingNeedsNoRequestAndReturnsTheSameRefusal() {
    RequestContextHolder.resetRequestAttributes();
    ResponseStatusException refusal = new ResponseStatusException(
      HttpStatus.FORBIDDEN
    );

    assertThat(GuardRefusal.refused(refusal)).isSameAs(refusal);
  }

  // ------------------------------------------------------------ declared status

  @Test
  void theStatusIsTheDeclaredSuccessStatusAndNeverTheOutcome()
    throws Exception {
    MockHttpServletRequest request = request("POST", "/api/v1/departments");
    MockHttpServletResponse response = new MockHttpServletResponse();
    interceptor.preHandle(
      request,
      response,
      handler(Handlers.class, "created")
    );
    // The client is about to see a 400; the label must not.
    response.setStatus(400);
    interceptor.afterCompletion(
      request,
      response,
      handler(Handlers.class, "created"),
      null
    );

    assertThat(count("/api/v1/departments", "POST", "201")).isEqualTo(1);
    assertThat(count("/api/v1/departments", "POST", "400")).isZero();
  }

  @Test
  void theDeclaredStatusComesFromTheMethodThenTheClassThenDefaultsTo200()
    throws Exception {
    assertThat(
      HttpMetricsInterceptor.declaredStatus(handler(Handlers.class, "created"))
    ).isEqualTo(HttpStatus.CREATED);
    assertThat(
      HttpMetricsInterceptor.declaredStatus(handler(Handlers.class, "gone"))
    ).isEqualTo(HttpStatus.NO_CONTENT);
    assertThat(
      HttpMetricsInterceptor.declaredStatus(
        handler(AcceptedController.class, "anything")
      )
    ).isEqualTo(HttpStatus.ACCEPTED);
    assertThat(
      HttpMetricsInterceptor.declaredStatus(handler(Handlers.class, "plain"))
    ).isEqualTo(HttpStatus.OK);
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
