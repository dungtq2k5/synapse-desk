package com.synapsedesk.gateway.openapi;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.HttpProbe;
import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ContextConfiguration;

/**
 * The two acceptance rows for {@link ErrorEnvelopeOperationCustomizer},
 * asserted against the real generated {@code /v3/api-docs} document rather
 * than a one-time diff against the committed Node document — these must keep
 * holding for every route added after the flip, not just the 230 ported at
 * migration time.
 *
 * <p><b>Closes its context when it finishes.</b> Spring caches a booted context
 * for the rest of the JVM, and this one holds the gateway lease with a live
 * cache-invalidation consumer on the shared broker — which silently evicts the
 * key {@code CacheInvalidationConsumerIT} asserts survives. Closing it runs the
 * lease's {@code @PreDestroy}, so nothing is left subscribed for the next class.
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

  @Test
  void everyRouteDocuments429SinceJavaHasNoThrottleExemptionYet() {
    // java-throttle-exemption-gap: Java has no @SkipThrottle equivalent, so
    // every route (including the 2 webhook intakes Node exempts) stays
    // throttled=true and documents 429. When a real skip mechanism lands,
    // this row is the one to relax for those two routes.
    for (Map<String, Object> operation : operations()) {
      Map<String, Object> responses = (Map<String, Object>) operation.get(
        "responses"
      );
      assertThat(responses)
        .as(
          "429 should be documented on every route for %s",
          operation.get("operationId")
        )
        .containsKey("429");
    }
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
