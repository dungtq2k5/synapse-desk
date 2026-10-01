package com.synapsedesk.gateway.lifecycle;

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
import org.springframework.test.context.ContextConfiguration;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The tenant-lifecycle category of EVERY route, against the table the Node gateway
 * recomputes from its own controllers' metadata ({@code org-access-routes.spec.ts}).
 *
 * <p>The gate's decision for a request is a function of its route, so a route Java
 * categorises differently from Node is a silent failure in one of two directions: a
 * sign-in route gated locks a frozen tenant's members out of learning why, and a
 * write route left open lets a frozen tenant keep writing. Contract rows prove the
 * behaviour for one route per category; this compares all of them.
 *
 * <p>What is compared is the EFFECTIVE category. Node gates only where
 * {@code JwtAuthGuard} ran and never gates {@code AUTH}; Java has no guard layer and
 * declares the routes Node leaves public as {@code AUTH} to be exempt, so both are the
 * same "exempt" here. A route behind {@code SuperAdminGuard} is exempt too: Node refuses
 * a non-super-admin before the gate, and exempts a super admin in it.
 */
@SpringBootTest(
  webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
  properties = { "management.server.port=0", "realtime.port=0" }
)
@ContextConfiguration(initializers = SharedEnvironmentInitializer.class)
class OrgAccessRoutesTest {

  private static final Path TABLE = Path.of(
    "..",
    "api-gateway",
    "test",
    "fixtures",
    "lifecycle",
    "org-access-routes.json"
  );

  @Autowired
  private RequestMappingHandlerMapping handlers;

  private static JsonNode table() {
    try {
      return JsonMapper.builder().build().readTree(Files.readString(TABLE));
    } catch (IOException failure) {
      throw new IllegalStateException(
        "could not read " + TABLE.toAbsolutePath(),
        failure
      );
    }
  }

  private HandlerMethod handlerFor(String pattern, String method) {
    for (Map.Entry<RequestMappingInfo, HandlerMethod> entry : handlers
      .getHandlerMethods()
      .entrySet()) {
      RequestMappingInfo info = entry.getKey();
      Set<String> patterns =
        info.getPathPatternsCondition() == null
          ? Set.of()
          : info.getPathPatternsCondition().getPatternValues();
      if (
        patterns.contains(pattern) &&
        info
          .getMethodsCondition()
          .getMethods()
          .contains(RequestMethod.valueOf(method))
      ) {
        return entry.getValue();
      }
    }

    return null;
  }

  /** {@code "EXEMPT"}, or the category the gate would ask about. */
  private static String effective(
    String kind,
    boolean guarded,
    boolean superAdminOnly
  ) {
    return !guarded || superAdminOnly || kind.equals("AUTH") ? "EXEMPT" : kind;
  }

  @Test
  void everyRouteIsGatedAsNodeGatesIt() {
    List<String> unmapped = new ArrayList<>();
    List<String> wrong = new ArrayList<>();
    int checked = 0;

    for (JsonNode row : table()) {
      String method = row.get(0).asString();
      String path = row.get(1).asString();
      HandlerMethod handler = handlerFor(path, method);
      if (handler == null) {
        unmapped.add(method + " " + path);
        continue;
      }

      String node = effective(
        row.get(2).asString(),
        row.get(3).asBoolean(),
        row.get(4).asBoolean()
      );
      OrgAccess kind = OrganizationLifecycleInterceptor.kindOf(handler, method);
      String java = effective(kind.name(), true, false);
      checked++;

      if (!java.equals(node)) {
        wrong.add(
          method +
            " " +
            path +
            ": Node gates it as " +
            node +
            ", Java as " +
            java
        );
      }
    }

    assertThat(unmapped).as("Node routes with no Java handler").isEmpty();
    assertThat(wrong).as("routes categorised differently from Node").isEmpty();
    // A walk that found nothing would report a perfectly satisfied contract.
    assertThat(checked).isGreaterThan(200);
  }

  @Test
  void theTableHoldsEveryCategoryAndBothGuardedAndPublicRoutes() {
    Set<String> kinds = new java.util.HashSet<>();
    int publicNonAuth = 0;
    for (JsonNode row : table()) {
      kinds.add(row.get(2).asString());
      if (
        !row.get(3).asBoolean() && !row.get(2).asString().equals("AUTH")
      ) publicNonAuth++;
    }

    assertThat(kinds).containsExactlyInAnyOrder(
      "AUTH",
      "READ",
      "WRITE",
      "ONBOARDING",
      "BILLING"
    );
    // The routes Node leaves public yet would otherwise gate: the ones Java must exempt by hand.
    assertThat(publicNonAuth).isGreaterThanOrEqualTo(5);
  }
}
