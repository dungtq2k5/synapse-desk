package com.synapsedesk.gateway.metrics;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * The labels {@link HttpMetricsInterceptor} writes, derived from every route the
 * gateway maps: each template in the {@code :id} form the dashboards read, and a handler with no
 * declared status labelled 200.
 *
 * <p>Which status each route DECLARES is not checked here: it is what the committed
 * {@code docs/reference/openapi.json} publishes, which {@code npm run openapi:check}
 * holds to the served document, and the contract rows hold to what each route answers.
 */
@SpringBootTest(
  webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
  properties = { "management.server.port=0", "realtime.port=0" }
)
@ContextConfiguration(initializers = SharedEnvironmentInitializer.class)
class HttpMetricsLabelsTest {

  @Autowired
  private RequestMappingHandlerMapping handlers;

  @Test
  void everyRouteTemplateIsExpressStyleAndFreeOfPathVariablesValues() {
    for (RequestMappingInfo info : handlers.getHandlerMethods().keySet()) {
      if (info.getPathPatternsCondition() == null) continue;
      for (String pattern : info
        .getPathPatternsCondition()
        .getPatternValues()) {
        String template = HttpMetricsInterceptor.routeTemplate(pattern);

        // Never a brace left in the label: `{id}` is a placeholder, `:id` is the
        // label's form, and a label that kept the braces is a different series.
        assertThat(template)
          .as(pattern)
          .doesNotContain("{")
          .doesNotContain("}");
      }
    }
  }

  @Test
  void theStatusLabelOfAnUnannotatedHandlerIs200() {
    HandlerMethod health = handlers
      .getHandlerMethods()
      .values()
      .stream()
      .filter(handler ->
        handler.getBeanType().getSimpleName().equals("OpsController")
      )
      .findFirst()
      .orElseThrow();

    assertThat(HttpMetricsInterceptor.declaredStatus(health)).isEqualTo(
      HttpStatus.OK
    );
  }
}
