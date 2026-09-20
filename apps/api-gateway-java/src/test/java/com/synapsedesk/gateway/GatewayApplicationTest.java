package com.synapsedesk.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ContextConfiguration;
import com.synapsedesk.gateway.config.SharedEnvironment;
import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;

/**
 * The skeleton boots, and refuses to boot without its environment.
 *
 * <p>Two rows rather than the usual one empty context-load test. The second
 * is the one worth having: {@code application.yaml} references {@code
 * ${PORT}} with no default, and a fallback added later would make a
 * misconfigured gateway start on a guessed port instead of failing at deploy
 * time. Nothing else would notice.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"PORT=0", "management.server.port=0"})
// Every `@ConfigurationProperties` record is bound and VALIDATED at refresh,
// so a context needs the whole shared environment, not just a port.
@ContextConfiguration(initializers = SharedEnvironmentInitializer.class)
class GatewayApplicationTest {

  @Autowired private Environment environment;

  @Test
  void bootsWithTheEnvironmentItIsGiven() {
    assertThat(environment.getProperty("spring.application.name"))
        .isEqualTo("api-gateway-java");
  }

  @Test
  void refusesToBootWithoutPort() {
    // The row only means something if the variable really is absent; a
    // developer with PORT exported would otherwise get a green that proves
    // nothing — and a process that binds a real port inside a unit test.
    assertThat(System.getenv("PORT")).as("PORT must be unset for this row").isNull();

    // **A WEB context on purpose.** Measured while writing this: with
    // `web-application-type=none` the application starts clean without PORT,
    // because `server.port` is never read — the placeholder resolves when the
    // servlet container starts, not when the environment is built. So the
    // refusal this row asserts is a property of booting as a server, which is
    // the only way this application is ever started.
    SpringApplication application = new SpringApplication(GatewayApplication.class);
    java.util.Map<String, Object> withoutPort =
        new java.util.HashMap<>(SharedEnvironment.values());
    withoutPort.remove("PORT");
    application.setDefaultProperties(withoutPort);

    assertThatThrownBy(
            () -> {
              try (ConfigurableApplicationContext ignored = application.run()) {
                // unreachable: the placeholder cannot resolve
              }
            })
        // The top-level message is "Unable to start web server"; the
        // unresolvable placeholder is in the CAUSE, so a `hasMessageContaining`
        // here would fail against a correct refusal.
        .hasStackTraceContaining("PORT");
  }
}
