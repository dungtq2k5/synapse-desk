package com.synapsedesk.gateway.modules.inboundemail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.synapsedesk.gateway.common.config.SharedEnvironment;
import com.synapsedesk.gateway.common.config.StoreProperties;
import com.synapsedesk.gateway.modules.inboundemail.InboundPublisher.Reason;
import io.nats.client.Connection;
import io.nats.client.Dispatcher;
import io.nats.client.Nats;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@link InboundPublisher} against a REAL NATS broker, started outside this
 * process and read from the shared environment like the other ITs: the row that
 * proves the rejection reaches the subject notification-service listens on, in the
 * envelope its consumer unwraps.
 */
class InboundPublisherIT {

  private static final JsonMapper JSON = JsonMapper.builder().build();

  private Connection subscriber;
  private InboundPublisher publisher;
  private final List<String> received = new CopyOnWriteArrayList<>();

  @BeforeEach
  void connect() throws Exception {
    String natsUrl = SharedEnvironment.values().getOrDefault(
      "NATS_URL",
      "nats://localhost:4222"
    );
    subscriber = Nats.connect(natsUrl);
    Dispatcher dispatcher = subscriber.createDispatcher(message ->
      received.add(new String(message.getData(), StandardCharsets.UTF_8))
    );
    dispatcher.subscribe(InboundPublisher.REJECTED_SUBJECT);
    subscriber.flush(Duration.ofSeconds(2));
    publisher = new InboundPublisher(
      new StoreProperties("redis://localhost:6379", natsUrl),
      JSON
    );
  }

  @AfterEach
  void disconnect() throws Exception {
    publisher.close();
    subscriber.close();
  }

  @Test
  void aRejectionReachesTheSubjectInNestsEnvelope() {
    publisher.rejected(
      "99999999-9999-4999-8999-999999999999",
      "customer@acme.test",
      Reason.SENDER_NOT_PERMITTED
    );

    await()
      .atMost(Duration.ofSeconds(5))
      .until(() -> !received.isEmpty());

    JsonNode envelope = JSON.readTree(received.get(0));
    assertThat(envelope.get("pattern").asString()).isEqualTo(
      "email.inbound_rejected"
    );
    assertThat(envelope.get("data").get("sender").asString()).isEqualTo(
      "customer@acme.test"
    );
    assertThat(envelope.get("data").get("reason").asString()).isEqualTo(
      "SENDER_NOT_PERMITTED"
    );
  }

  @Test
  void theConnectionIsReusedAcrossRejections() {
    publisher.rejected("o1", "a@x.test", Reason.UNROUTABLE);
    publisher.rejected("o2", "b@x.test", Reason.SENDER_NOT_PERMITTED);
    publisher.rejected("o3", "c@x.test", Reason.UNROUTABLE);

    await()
      .atMost(Duration.ofSeconds(5))
      .until(() -> received.size() == 3);

    assertThat(received).allSatisfy(body ->
      assertThat(body).contains("email.inbound_rejected")
    );
  }
}
