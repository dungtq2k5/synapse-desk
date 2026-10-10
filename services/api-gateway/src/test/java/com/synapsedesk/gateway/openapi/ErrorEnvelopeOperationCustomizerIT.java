package com.synapsedesk.gateway.openapi;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.HttpProbe;
import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import com.synapsedesk.gateway.throttle.SkipThrottle;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * The two acceptance rows for {@link ErrorEnvelopeOperationCustomizer},
 * asserted against the real generated {@code /v3/api-docs} document rather
 * than a one-time diff against the committed document — these must keep
 * holding for every route, including each one added later.
 *
 * <p><b>Closes its context when it finishes.</b> Spring caches a booted context
 * for the rest of the JVM, and this one has a live cache-invalidation consumer
 * on the shared broker — which silently evicts the key
 * {@code CacheInvalidationConsumerIT} asserts survives. Closing it stops the
 * consumer, so nothing is left subscribed for the next class.
 */
@SpringBootTest(
  webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
  // The document is served only where `SWAGGER_ENABLED` turns it on.
  properties = { "management.server.port=0", "SWAGGER_ENABLED=true" }
)
@ContextConfiguration(initializers = SharedEnvironmentInitializer.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ErrorEnvelopeOperationCustomizerIT {

  @Value("${local.server.port}")
  private int port;

  private static final List<String> HTTP_METHODS = List.of(
    "get",
    "post",
    "put",
    "patch",
    "delete"
  );

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> operations() {
    Map<String, Object> document = HttpProbe.get(port, "/v3/api-docs").json();
    Map<String, Object> paths = (Map<String, Object>) document.get("paths");
    List<Map<String, Object>> operations = new java.util.ArrayList<>();
    for (Object pathItem : paths.values()) {
      Map<String, Object> methods = (Map<String, Object>) pathItem;
      for (String method : HTTP_METHODS) {
        if (methods.containsKey(method)) {
          operations.add((Map<String, Object>) methods.get(method));
        }
      }
    }
    return operations;
  }

  @Test
  void everyRouteDocuments415IffItTakesABody() {
    for (Map<String, Object> operation : operations()) {
      Map<String, Object> responses = (Map<String, Object>) operation.get(
        "responses"
      );
      boolean has415 = responses.containsKey("415");
      boolean hasBody = operation.containsKey("requestBody");
      assertThat(has415)
        .as(
          "415 presence should equal @RequestBody presence for %s",
          operation.get("operationId")
        )
        .isEqualTo(hasBody);
    }
  }

  @Autowired
  private RequestMappingHandlerMapping handlerMapping;

  /**
   * The handler methods that carry {@link SkipThrottle}, by name with the
   * underscores and case an operationId adds removed:
   * `WebhooksController_stripe_v1` and `webhooksControllerStripeV1` meet.
   */
  private Set<String> exemptHandlers() {
    Set<String> exempt = new HashSet<>();
    for (HandlerMethod handler : handlerMapping.getHandlerMethods().values()) {
      if (
        handler.hasMethodAnnotation(SkipThrottle.class) ||
        handler.getBeanType().isAnnotationPresent(SkipThrottle.class)
      ) {
        exempt.add(normalized(handler.getMethod().getName()));
      }
    }
    return exempt;
  }

  private static String normalized(String name) {
    return name.replace("_", "").toLowerCase(java.util.Locale.ROOT);
  }

  @Test
  void a429IsDocumentedExactlyWhereTheRouteIsThrottled() {
    Set<String> exempt = exemptHandlers();
    // The two webhook intakes; zero would mean the lookup matched nothing.
    assertThat(exempt).hasSizeGreaterThanOrEqualTo(2);

    int documented = 0;
    for (Map<String, Object> operation : operations()) {
      Map<String, Object> responses = (Map<String, Object>) operation.get(
        "responses"
      );
      boolean throttled = !exempt.contains(
        normalized((String) operation.get("operationId"))
      );
      if (!throttled) documented += 1;
      assertThat(responses.containsKey("429"))
        .as("429 documented for %s", operation.get("operationId"))
        .isEqualTo(throttled);
    }
    // Every exempt handler was found in the document, so none was compared
    // against the wrong rule.
    assertThat(documented).isEqualTo(exempt.size());
  }

  @Test
  void everyRouteDocuments500() {
    for (Map<String, Object> operation : operations()) {
      Map<String, Object> responses = (Map<String, Object>) operation.get(
        "responses"
      );
      assertThat(responses)
        .as(
          "500 should be documented on every route for %s",
          operation.get("operationId")
        )
        .containsKey("500");
    }
  }
}
