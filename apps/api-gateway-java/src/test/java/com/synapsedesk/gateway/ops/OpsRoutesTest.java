package com.synapsedesk.gateway.ops;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.beans.factory.annotation.Value;
import com.synapsedesk.gateway.HttpProbe;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ContextConfiguration;

/**
 * The three ops routes, over real HTTP, on the PUBLIC listener.
 *
 * <p>Each row asserts what the contract harness asserts of the Node gateway,
 * so the two implementations answer the same thing: the envelope's
 * {@code success} and {@code data}, a semver-shaped version, and a readiness
 * that flips the STATUS LINE rather than only a field.
 */
// **`management.server.port=0` on purpose.** The scrape listener is a CHILD
// context, and it does not see property sources an
// `ApplicationContextInitializer` added to the parent — in production
// `METRICS_PORT` is a real environment variable, which the child does
// inherit, so this is a gap in the test's synthetic environment rather than
// in the configuration. A fixed port would also collide between suites.
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "management.server.port=0")
@ContextConfiguration(initializers = SharedEnvironmentInitializer.class)
class OpsRoutesTest {

  /**
   * **The lease is stubbed here, and the real one has its own IT.**
   *
   * <p>Without Redis this process is a STANDBY, which is correct — and it
   * makes `/health/ready` 503, which is what this row would then measure
   * instead of what it is about. The Node side needed the same fixture for
   * the same reason (`leaseSwitch`): the rows about routing need a steady
   * answer, and the claim, refresh, fence and release are exercised against a
   * real Redis in `GatewayLeaseIT`.
   */
  @org.springframework.test.context.bean.override.mockito.MockitoBean
  private com.synapsedesk.gateway.lease.GatewayLeaseService lease;

  @Value("${local.server.port}")
  private int port;

  @org.junit.jupiter.api.BeforeEach
  void holdTheLease() {
    org.mockito.Mockito.when(lease.isReady()).thenReturn(true);
  }

  @Autowired private DrainState drain;

  @AfterEach
  void stopDraining() {
    // `DrainState` is a singleton in a CACHED context, so a row that drains
    // and does not undo it fails the next row in a way that points nowhere.
    drain.reset();
  }

  @Test
  void servesVersionOutsideThePrefix() {
    HttpProbe response = HttpProbe.get(port, "/version");

    assertThat(response.status()).isEqualTo(HttpStatus.OK.value());
    assertThat(response.json()).containsEntry("success", true);
    assertThat((String) response.data().get("version")).matches("^\\d+\\.\\d+\\.\\d+.*");
  }

  @Test
  void healthIs200AndReadinessIs200WhileServing() {
    assertThat(HttpProbe.get(port, "/health").status()).isEqualTo(HttpStatus.OK.value());

    HttpProbe ready = HttpProbe.get(port, "/health/ready");
    assertThat(ready.status()).isEqualTo(HttpStatus.OK.value());
    assertThat(ready.data()).containsEntry("ready", true);
  }

  @Test
  void readinessGoesRedWhileDrainingAndHealthStays200() {
    drain.startDraining();

    // The whole shape of a graceful shutdown: the Service stops routing here
    // while in-flight requests finish, and the kubelet does not restart a pod
    // that is deliberately not taking traffic.
    assertThat(HttpProbe.get(port, "/health/ready").status())
        .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE.value());
    assertThat(HttpProbe.get(port, "/health").status()).isEqualTo(HttpStatus.OK.value());
  }

  @Test
  void theOpsRoutesAreNotUnderTheApiPrefix() {
    // A probe configured for `/api/v1/health` breaks the day the version
    // moves, and it breaks by restarting healthy pods.
    assertThat(HttpProbe.get(port, "/api/v1/health").status())
        .isEqualTo(HttpStatus.NOT_FOUND.value());
  }
}
