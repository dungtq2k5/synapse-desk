package com.synapsedesk.gateway.throttle;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.HttpProbe;
import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ContextConfiguration;

/**
 * {@link ThrottlerInterceptor} reached through a REAL request, the wiring
 * half {@link ThrottlerInterceptorTest} cannot cover.
 *
 * <p><b>The gap this closes.</b> A {@code HandlerInterceptor} is an ordinary
 * bean until {@link com.synapsedesk.gateway.security.WebMvcConfig#addInterceptors}
 * names it — unlike a {@code @Component Filter}, which Boot auto-registers.
 * `ThrottlerInterceptor` compiled, injected, and never ran — a gap that
 * would have gone unnoticed indefinitely: every unit-level row on the
 * interceptor's logic would still have passed, because none of them go
 * through `WebMvcConfig` at all —
 * {@link ThrottlerInterceptorTest} constructs it directly, the same way
 * {@code PermissionInterceptorTest} does for its sibling. Only a real request
 * through the real Spring MVC pipeline can fail when the registration line is
 * missing, so that is what this asserts.
 *
 * <p><b>Sabotage-verified.</b> Commenting out {@code
 * registry.addInterceptor(throttlerInterceptor)} in {@code WebMvcConfig} turns
 * {@link #aRegisteredInterceptorRefusesOverTheShortTierLimit} red — the
 * request keeps succeeding past the configured limit, because nothing is
 * counting it. Restored, it passes again.
 *
 * <p>{@code /health} carries no {@link AuthThrottle}, so it evaluates the
 * GENERAL tiers — `short`, tightened to 2 here so the row runs in three
 * requests rather than 31. A per-test random {@code X-Forwarded-For} keeps
 * this run's bucket from colliding with a previous one still inside its TTL.
 */
@SpringBootTest(
  webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
  properties = {
    "management.server.port=0",
    "realtime.port=0",
    "throttle.short-ttl=60000",
    "throttle.short-limit=2",
  }
)
@ContextConfiguration(initializers = SharedEnvironmentInitializer.class)
class ThrottlerWiringTest {

  @Value("${local.server.port}")
  private int port;

  @Test
  void aRegisteredInterceptorRefusesOverTheShortTierLimit() {
    // Not a real IP — the tracker only ever uses this value as an opaque
    // Redis-key component, never parses it, so a fresh UUID per run is
    // enough to keep this test's bucket from colliding with a previous run
    // still inside its TTL.
    Map<String, String> headers = Map.of(
      "X-Forwarded-For",
      UUID.randomUUID().toString()
    );

    HttpProbe first = HttpProbe.get(port, "/health", headers);
    HttpProbe second = HttpProbe.get(port, "/health", headers);
    HttpProbe third = HttpProbe.get(port, "/health", headers);

    assertThat(first.status()).isEqualTo(200);
    assertThat(second.status()).isEqualTo(200);
    assertThat(third.status()).isEqualTo(429);
  }
}
