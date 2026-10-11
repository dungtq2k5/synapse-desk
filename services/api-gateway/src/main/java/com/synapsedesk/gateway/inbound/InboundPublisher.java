package com.synapsedesk.gateway.inbound;

import com.synapsedesk.gateway.common.config.JsIsoFormat;
import com.synapsedesk.gateway.common.config.StoreProperties;
import io.nats.client.Connection;
import io.nats.client.Nats;
import io.nats.client.Options;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * Tells notification-service that mail was refused, so the sender is told once.
 *
 * <p>The gateway's only NATS publisher. <b>Fire-and-forget, and it never
 * throws</b>: the webhook answers 200 for every deliberate outcome, so the drop
 * path cannot be allowed to fail because a broker was briefly unreachable. A
 * rejection that fails to publish costs one unsent courtesy reply; an exception
 * here would turn a drop into a 5xx and make the provider redeliver mail this
 * system has already refused.
 *
 * <p>It does not even wait: the publish runs on its own thread, so a broker that
 * is down costs the connection attempt on that thread and not the webhook's.
 *
 * <p>The envelope is Nest's {@code ClientProxy.emit} on the wire,
 * {@code {"pattern": <subject>, "data": <event>}}, which is what
 * notification-service's {@code @EventPattern} consumer unwraps.
 */
@Component
public class InboundPublisher {

  private static final Logger LOG = LoggerFactory.getLogger(
    InboundPublisher.class
  );

  /** {@code EMAIL_INBOUND_PATTERNS.rejected}. */
  public static final String REJECTED_SUBJECT = "email.inbound_rejected";

  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);

  private final StoreProperties stores;
  private final ObjectMapper json;
  private Connection connection;

  public InboundPublisher(StoreProperties stores, ObjectMapper json) {
    this.stores = stores;
    this.json = json;
  }

  /** Why a message was refused — carried for the log, not for the reply. */
  public enum Reason {
    UNROUTABLE,
    SENDER_NOT_PERMITTED,
  }

  /** Publishes the refusal on its own thread; never throws. */
  public void rejected(String organizationId, String sender, Reason reason) {
    byte[] payload = envelope(
      json,
      organizationId,
      sender,
      reason,
      Instant.now()
    );

    Thread.startVirtualThread(() -> publish(payload));
  }

  /**
   * The bytes on the wire. {@code occurredAt} is ISO 8601 from the publisher's
   * clock, the rule every contract here follows, written the way
   * {@code Date.prototype.toISOString()} writes it: three fractional digits,
   * always, which {@link Instant#toString()} does not.
   */
  static byte[] envelope(
    ObjectMapper json,
    String organizationId,
    String sender,
    Reason reason,
    Instant now
  ) {
    Map<String, Object> event = new LinkedHashMap<>();
    event.put("pattern", REJECTED_SUBJECT);
    event.put("occurredAt", JsIsoFormat.PATTERN.format(now));
    event.put("organizationId", organizationId);
    event.put("sender", sender);
    event.put("reason", reason.name());

    Map<String, Object> envelope = new LinkedHashMap<>();
    envelope.put("pattern", REJECTED_SUBJECT);
    envelope.put("data", event);

    return json.writeValueAsString(envelope).getBytes(StandardCharsets.UTF_8);
  }

  private void publish(byte[] payload) {
    try {
      connection().publish(REJECTED_SUBJECT, payload);
    } catch (Exception failure) {
      forget();
      LOG.error(
        "Could not publish an inbound rejection: {}",
        failure.getMessage()
      );
    }
  }

  private synchronized Connection connection() throws Exception {
    if (
      connection == null || connection.getStatus() == Connection.Status.CLOSED
    ) {
      connection = Nats.connect(
        new Options.Builder()
          .server(stores.natsUrl())
          .connectionTimeout(CONNECT_TIMEOUT)
          .build()
      );
    }

    return connection;
  }

  /** Drops a connection that failed a publish, so the next one reconnects rather than reusing it. */
  private synchronized void forget() {
    Connection broken = connection;
    connection = null;
    if (broken == null) return;
    try {
      broken.close();
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
    }
  }

  @PreDestroy
  synchronized void close() throws InterruptedException {
    if (connection != null) {
      connection.close();
      connection = null;
    }
  }
}
