package com.synapsedesk.gateway.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import com.synapsedesk.gateway.GatewayApplication;

/**
 * The nine properties classes bind the shared environment, and refuse without
 * it.
 *
 * <p><b>Two refusal mechanisms, and they cover different faults</b> — worth
 * stating because the plan expected one. A key that is ABSENT fails when the
 * placeholder in {@code application.yaml} cannot resolve; a key that is
 * PRESENT BUT EMPTY resolves fine and is caught by {@code @NotBlank}. Both
 * happen at context refresh, which is the property that matters: step 2
 * measured that {@code server.port}'s placeholder waits for the servlet
 * container, and {@code @ConfigurationProperties} does not.
 */
class ConfigBindingTest {

  /** Boots with the shared example, minus and plus whatever a row changes. */
  private ConfigurableApplicationContext boot(Map<String, Object> overrides) {
    Map<String, Object> properties = new HashMap<>(SharedEnvironment.values());
    properties.put("spring.main.web-application-type", "none");
    properties.put("management.server.port", "0");
    properties.putAll(overrides);

    SpringApplication application = new SpringApplication(GatewayApplication.class);
    application.setDefaultProperties(properties);

    return application.run();
  }

  @Test
  void bindsEveryGroupFromTheSharedExample() {
    try (ConfigurableApplicationContext context = boot(Map.of())) {
      assertThat(context.getBean(RuntimeProperties.class).globalPrefix()).isEqualTo("api");
      assertThat(context.getBean(MetricsProperties.class).port()).isEqualTo(9464);
      assertThat(context.getBean(CorsProperties.class).origins()).contains("http://localhost:5173");
      assertThat(context.getBean(StoreProperties.class).natsUrl()).isEqualTo("nats://localhost:4222");
      assertThat(context.getBean(GrpcProperties.class).ragServiceUrl()).isEqualTo("localhost:50255");
      assertThat(context.getBean(JwtProperties.class).twoFactorName()).isEqualTo("mfa_token");
      assertThat(context.getBean(ThrottleProperties.class).authTtl()).isEqualTo(900_000L);
      assertThat(context.getBean(InboundEmailProperties.class).sender())
          .isEqualTo("\"SynapseDesk\" <noreply@example.com>");
    }
  }

  @Test
  void appliesTheSameTwoDefaultsTheNodeSchemaDoes() {
    // Both are COMMENTED in `.env.example`, so the shared environment supplies
    // neither and this row exercises the default rather than a value.
    try (ConfigurableApplicationContext context = boot(Map.of())) {
      assertThat(context.getBean(RuntimeProperties.class).swaggerEnabled()).isFalse();
      assertThat(context.getBean(MetricsProperties.class).host()).isEqualTo("127.0.0.1");
    }
  }

  @Test
  void refusesWhenARequiredKeyIsAbsent() {
    Map<String, Object> properties = new HashMap<>(SharedEnvironment.values());
    properties.remove("INBOUND_EMAIL_SECRET");
    properties.put("spring.main.web-application-type", "none");
    properties.put("management.server.port", "0");

    SpringApplication application = new SpringApplication(GatewayApplication.class);
    application.setDefaultProperties(properties);

    // Names the ENV key, which is the name the person fixing it has.
    assertThatThrownBy(application::run).hasStackTraceContaining("INBOUND_EMAIL_SECRET");
  }

  @Test
  void refusesWhenARequiredKeyIsEmpty() {
    // The case a placeholder cannot catch: the variable is set, so it
    // resolves, and an empty secret would otherwise be bound and used.
    assertThatThrownBy(() -> boot(Map.of("INBOUND_EMAIL_SECRET", "")).close())
        .hasStackTraceContaining("inbound.secret")
        .hasStackTraceContaining("must not be blank");
  }

  @Test
  void refusesACookieNameThatIsNotALegalToken() {
    // A trailing `;` is the easy typo and the worst one: `;` is the cookie
    // SEPARATOR, so the name silently ends the previous pair. Nothing fails at
    // boot on the Node side without the schema's pattern — it throws on the
    // first login instead.
    assertThatThrownBy(() -> boot(Map.of("JWT_ACCESS_NAME", "access_token;")).close())
        // The binder reports the FIELD (`accessName`) and the origin line in
        // `application.yaml`, not the kebab-case property path.
        .hasStackTraceContaining("accessName")
        .hasStackTraceContaining("is not a valid cookie name");
  }

  @Test
  void convertsCookieMaxAgeFromMillisecondsExactlyOnce() {
    try (ConfigurableApplicationContext context = boot(Map.of())) {
      CookieProperties cookies = context.getBean(CookieProperties.class);

      // `.env.example` carries MILLISECONDS. The bound Duration is the same
      // instant of time, and `ResponseCookie` writes it as SECONDS — the row
      // below is the one that fails if the conversion is done twice, or not
      // at all, or again at a call site.
      assertThat(cookies.accessMaxAge()).isEqualTo(Duration.ofMillis(901_000));
      assertThat(cookies.refreshMaxAge()).isEqualTo(Duration.ofMillis(604_801_000));
      assertThat(cookies.twoFactorMaxAge()).isEqualTo(Duration.ofMillis(301_000));
      assertThat(cookies.deviceMaxAge()).isEqualTo(Duration.ofMillis(2_592_000_000L));
      assertThat(cookies.tenantSelectionMaxAge()).isEqualTo(Duration.ofMillis(300_000));
    }
  }
}
