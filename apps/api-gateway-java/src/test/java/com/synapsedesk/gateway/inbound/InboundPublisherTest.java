package com.synapsedesk.gateway.inbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.config.StoreProperties;
import com.synapsedesk.gateway.inbound.InboundPublisher.Reason;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The rejection event's bytes, and the one promise the drop path depends on: that
 * publishing never throws. The delivery to a real broker is
 * {@code InboundPublisherIT}'s.
 */
class InboundPublisherTest {

  private static final JsonMapper JSON = JsonMapper.builder().build();

  @Test
  void theEnvelopeIsNestsEmitWithTheEventUnderData() {
    byte[] bytes = InboundPublisher.envelope(
      JSON,
      "99999999-9999-4999-8999-999999999999",
      "customer@acme.test",
      Reason.SENDER_NOT_PERMITTED,
      Instant.parse("2026-10-01T09:00:00.123Z")
    );

    JsonNode envelope = JSON.readTree(
      new String(bytes, StandardCharsets.UTF_8)
    );
    assertThat(envelope.get("pattern").asString()).isEqualTo(
      "email.inbound_rejected"
    );
    JsonNode event = envelope.get("data");
    // The event carries its own pattern, as `InboundEmailRejectedEvent` does.
    assertThat(event.get("pattern").asString()).isEqualTo(
      "email.inbound_rejected"
    );
    assertThat(event.get("occurredAt").asString()).isEqualTo(
      "2026-10-01T09:00:00.123Z"
    );
    assertThat(event.get("organizationId").asString()).isEqualTo(
      "99999999-9999-4999-8999-999999999999"
    );
    assertThat(event.get("sender").asString()).isEqualTo("customer@acme.test");
    assertThat(event.get("reason").asString()).isEqualTo(
      "SENDER_NOT_PERMITTED"
    );
    assertThat(envelope.size()).isEqualTo(2);
    assertThat(event.size()).isEqualTo(5);
  }

  @Test
  void occurredAtIsTheMillisecondFormJavaScriptWrites() {
    // `Instant.toString()` would give nanoseconds here, and drop the zeros there.
    for (var row : java.util.Map.of(
      "2026-10-01T09:00:00.100123456Z",
      "2026-10-01T09:00:00.100Z",
      "2026-10-01T09:00:00Z",
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T09:00:00.120Z",
      "2026-10-01T09:00:00.120Z"
    ).entrySet()) {
      byte[] bytes = InboundPublisher.envelope(
        JSON,
        "o",
        "s@x.test",
        Reason.UNROUTABLE,
        Instant.parse(row.getKey())
      );

      assertThat(
        JSON.readTree(bytes).get("data").get("occurredAt").asString()
      ).isEqualTo(row.getValue());
    }
  }

  @Test
  void bothReasonsSerialiseAsTheirContractNames() {
    for (Reason reason : Reason.values()) {
      byte[] bytes = InboundPublisher.envelope(
        JSON,
        "o",
        "s@x.test",
        reason,
        Instant.now()
      );

      assertThat(
        JSON.readTree(bytes).get("data").get("reason").asString()
      ).isEqualTo(reason.name());
    }
    assertThat(Reason.values())
      .extracting(Enum::name)
      .containsExactlyInAnyOrder("UNROUTABLE", "SENDER_NOT_PERMITTED");
  }

  @Test
  void aBrokerThatNeverAnswersNeitherThrowsNorBlocksTheCaller()
    throws Exception {
    // Accepts the connection and says nothing, so the handshake stalls until the
    // publisher's own connect timeout: refused-at-once would pass for a publisher
    // that blocks too.
    try (java.net.ServerSocket silent = new java.net.ServerSocket(0)) {
      InboundPublisher publisher = new InboundPublisher(
        new StoreProperties(
          "redis://localhost:1",
          "nats://127.0.0.1:" + silent.getLocalPort()
        ),
        JSON
      );

      long started = System.nanoTime();
      publisher.rejected("o", "s@x.test", Reason.UNROUTABLE);

      // The publish runs on its own thread: the webhook that triggered it does not
      // wait for a connection attempt, let alone fail on one.
      assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(
        Duration.ofMillis(500)
      );
    }
  }
}
