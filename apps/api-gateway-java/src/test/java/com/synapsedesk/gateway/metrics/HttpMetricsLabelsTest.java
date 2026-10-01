package com.synapsedesk.gateway.metrics;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The status label {@link HttpMetricsInterceptor} would write for EVERY route,
 * against the status Node's committed document gives that route.
 *
 * <p>The label is the route's declared success status, so it is only as right as the
 * declaration on each handler. A handful of contract rows cannot show that every
 * route is declared as Node declares it; this reads all of them. The oracle is Node's
 * document, not Java's own: springdoc derives its documented status from the same
 * annotation the label reads, so comparing the two would agree with itself forever.
 *
 * <p>The three stale entries in the known-divergences manifest (the webhook
 * endpoints, where the document says 200 and Node's runtime answers 201) take the
 * manifest's Java value, which is Node's real behaviour.
 */
@SpringBootTest(
  webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
  properties = { "management.server.port=0", "realtime.port=0" }
)
@ContextConfiguration(initializers = SharedEnvironmentInitializer.class)
class HttpMetricsLabelsTest {

  private static final Path NODE_DOCUMENT = Path.of(
    "..",
    "..",
    "docs",
    "reference",
    "openapi.json"
  );
  private static final Path DIVERGENCES = Path.of(
    "..",
    "..",
    "scripts",
    "lib",
    "openapi-known-divergences.json"
  );

  @Autowired
  private RequestMappingHandlerMapping handlers;

  private static JsonNode read(Path path) {
    try {
      return JsonMapper.builder().build().readTree(Files.readString(path));
    } catch (IOException failure) {
      throw new IllegalStateException(
        "could not read " + path.toAbsolutePath(),
        failure
      );
    }
  }

  /** {@code "POST /api/v1/webhook-endpoints"} to the status Java answers, for the stale document entries. */
  private static Map<String, Integer> javaSuccessOverrides() {
    Map<String, Integer> overrides = new java.util.HashMap<>();
    for (JsonNode row : read(DIVERGENCES)) {
      if (row.get("kind").asString().equals("success")) {
        overrides.put(
          row.get("route").asString(),
          Integer.parseInt(row.get("java").get(0).asString())
        );
      }
    }

    return overrides;
  }

  /** The handler for {@code method pattern}, or {@code null}. */
  private HandlerMethod handlerFor(String pattern, String method) {
    for (Map.Entry<RequestMappingInfo, HandlerMethod> entry : handlers
      .getHandlerMethods()
      .entrySet()) {
      RequestMappingInfo info = entry.getKey();
      Set<String> patterns =
        info.getPathPatternsCondition() == null
          ? Set.of()
          : info.getPathPatternsCondition().getPatternValues();
      Set<RequestMethod> methods = info.getMethodsCondition().getMethods();
      if (
        patterns.contains(pattern) &&
        methods.contains(RequestMethod.valueOf(method))
      ) {
        return entry.getValue();
      }
    }

    return null;
  }

  @Test
  void everyDocumentedRouteIsLabelledWithTheStatusNodeDocumentsForIt() {
    JsonNode paths = read(NODE_DOCUMENT).get("paths");
    Map<String, Integer> overrides = javaSuccessOverrides();
    List<String> wrong = new ArrayList<>();
    List<String> unmapped = new ArrayList<>();
    int checked = 0;

    for (Map.Entry<String, JsonNode> path : paths.properties()) {
      for (Map.Entry<String, JsonNode> operation : path
        .getValue()
        .properties()) {
        String method = operation.getKey().toUpperCase();
        if (
          !List.of("GET", "POST", "PUT", "PATCH", "DELETE").contains(method)
        ) continue;

        String key = method + " " + path.getKey();
        HandlerMethod handler = handlerFor(path.getKey(), method);
        if (handler == null) {
          unmapped.add(key);
          continue;
        }

        int documented = overrides.getOrDefault(
          key,
          successStatusOf(operation.getValue())
        );
        int labelled = HttpMetricsInterceptor.declaredStatus(handler).value();
        checked++;

        if (labelled != documented) {
          wrong.add(
            key + ": labelled " + labelled + ", Node documents " + documented
          );
        }
      }
    }

    assertThat(unmapped).as("documented routes with no Java handler").isEmpty();
    assertThat(wrong)
      .as("routes labelled with a status other than Node's")
      .isEmpty();
    // A walk that found nothing would report a perfectly satisfied contract.
    assertThat(checked).isGreaterThan(200);
  }

  private static int successStatusOf(JsonNode operation) {
    int lowest = Integer.MAX_VALUE;
    for (Map.Entry<String, JsonNode> response : operation
      .get("responses")
      .properties()) {
      String code = response.getKey();
      if (code.startsWith("2")) lowest = Math.min(
        lowest,
        Integer.parseInt(code)
      );
    }

    return lowest;
  }

  @Test
  void everyRouteTemplateIsExpressStyleAndFreeOfPathVariablesValues() {
    for (RequestMappingInfo info : handlers.getHandlerMethods().keySet()) {
      if (info.getPathPatternsCondition() == null) continue;
      for (String pattern : info
        .getPathPatternsCondition()
        .getPatternValues()) {
        String template = HttpMetricsInterceptor.routeTemplate(pattern);

        // Never a brace left in the label: `{id}` is a placeholder, `:id` is the
        // label Node writes, and a label that kept the braces is a different series.
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
