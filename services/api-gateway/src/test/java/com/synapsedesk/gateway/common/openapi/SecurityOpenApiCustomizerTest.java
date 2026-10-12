package com.synapsedesk.gateway.common.openapi;

import static org.assertj.core.api.Assertions.assertThat;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.web.method.HandlerMethod;

/**
 * The rule: a handler is published as secured by the session cookie unless it
 * carries {@link RouteSecurity}, and then it is published as that marker says.
 */
class SecurityOpenApiCustomizerTest {

  private final SecurityOpenApiCustomizer customizer =
    new SecurityOpenApiCustomizer();

  static class Handlers {

    public void unmarked() {}

    @RouteSecurity(RouteSecurity.Scheme.NONE)
    public void open() {}

    @RouteSecurity(RouteSecurity.Scheme.REFRESH_COOKIE)
    public void refresh() {}

    @RouteSecurity(RouteSecurity.Scheme.MFA_COOKIE)
    public void challenge() {}

    @RouteSecurity(RouteSecurity.Scheme.SESSION_OR_CHALLENGE)
    public void either() {}
  }

  private Operation publish(String method) throws Exception {
    HandlerMethod handler = new HandlerMethod(
      new Handlers(),
      Handlers.class.getMethod(method)
    );

    return customizer.customize(new Operation(), handler);
  }

  private static String schemeOf(Operation operation) {
    assertThat(operation.getSecurity()).hasSize(1);

    return operation.getSecurity().get(0).keySet().iterator().next();
  }

  @Test
  void anUnmarkedHandlerIsSecuredByTheSessionCookie() throws Exception {
    assertThat(schemeOf(publish("unmarked"))).isEqualTo("access-cookie");
  }

  @Test
  void aPublicHandlerPublishesAnEmptyRequirementList() throws Exception {
    assertThat(publish("open").getSecurity()).isEmpty();
  }

  @Test
  void theTwoSpecialCookiesAreNamedByTheirOwnScheme() throws Exception {
    assertThat(schemeOf(publish("refresh"))).isEqualTo("refresh-cookie");
    assertThat(schemeOf(publish("challenge"))).isEqualTo("mfa-cookie");
  }

  @Test
  void aRouteThatAdmitsEitherCredentialPublishesBothAsAlternatives()
    throws Exception {
    assertThat(
      publish("either")
        .getSecurity()
        .stream()
        .map(requirement -> requirement.keySet())
        .toList()
    ).containsExactly(Set.of("access-cookie"), Set.of("mfa-cookie"));
  }

  @Test
  void theThreeSchemesAreCookiesWithTheNamesTheSessionUses() {
    OpenAPI document = new OpenAPI().components(new Components());

    customizer.customise(document);

    assertThat(document.getComponents().getSecuritySchemes()).containsOnlyKeys(
      "access-cookie",
      "mfa-cookie",
      "refresh-cookie"
    );
    assertThat(
      document
        .getComponents()
        .getSecuritySchemes()
        .get("refresh-cookie")
        .getName()
    ).isEqualTo("refresh_token");
  }
}
