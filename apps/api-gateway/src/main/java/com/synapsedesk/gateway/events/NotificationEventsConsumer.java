package com.synapsedesk.gateway.events;

import com.synapsedesk.gateway.config.StoreProperties;
import com.synapsedesk.gateway.contracts.RealtimeEvents;
import com.synapsedesk.gateway.contracts.Subjects;
import com.synapsedesk.gateway.lease.LeaseParticipant;
import com.synapsedesk.gateway.metrics.GatewayMetrics;
import com.synapsedesk.gateway.realtime.RealtimeRelay;
import com.synapsedesk.gateway.realtime.RealtimeRooms;
import io.nats.client.Connection;
import io.nats.client.Dispatcher;
import io.nats.client.Message;
import io.nats.client.Nats;
import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * `NotificationEventsConsumer`, reproduced — see {@link TicketEventsConsumer}
 * for the shared reasoning. Every target here is `userRoom` only; there is no
 * org-wide notification room.
 */
@Component
@Order(10)
public class NotificationEventsConsumer implements LeaseParticipant {

  private static final Logger LOG = LoggerFactory.getLogger(
    NotificationEventsConsumer.class
  );

  private static final List<String> SUBJECTS = List.of(
    Subjects.NOTIFICATION_REALTIME_CREATED,
    Subjects.NOTIFICATION_REALTIME_UPDATED,
    Subjects.NOTIFICATION_REALTIME_READ
  );

  private final StoreProperties store;
  private final RealtimeRelay relay;
  private final GatewayMetrics metrics;
  private final ObjectMapper json;

  private volatile Connection connection;

  public NotificationEventsConsumer(
    StoreProperties store,
    RealtimeRelay relay,
    GatewayMetrics metrics,
    ObjectMapper json
  ) {
    this.store = store;
    this.relay = relay;
    this.metrics = metrics;
    this.json = json;
  }

  @Override
  public synchronized void activate() {
    try {
      Connection opened = Nats.connect(store.natsUrl());
      Dispatcher dispatcher = opened.createDispatcher(this::onMessage);
      for (String subject : SUBJECTS) {
        dispatcher.subscribe(subject);
      }
      // "activate() returned" must mean "subscribed": the SUBs are queued on
      // the connection, and core NATS drops an event published before the broker
      // has them. Flushing waits for the broker to have read them all.
      opened.flush(Duration.ofSeconds(5));
      connection = opened;
      LOG.info(
        "Notification events consumer subscribed to {} subjects",
        SUBJECTS.size()
      );
    } catch (InterruptedException failure) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(
        "Could not start the notification events consumer",
        failure
      );
    } catch (IOException | TimeoutException failure) {
      throw new IllegalStateException(
        "Could not start the notification events consumer",
        failure
      );
    }
  }

  @Override
  public synchronized void deactivate() {
    Connection open = connection;
    connection = null;
    if (open == null) {
      return;
    }

    try {
      open.close();
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
    }
  }

  void onMessage(Message message) {
    String subject = message.getSubject();
    try {
      relay(subject, message.getData());
      metrics.websocketEvent(subject);
    } catch (RuntimeException failure) {
      LOG.error("Could not relay {}: {}", subject, failure.getMessage());
    }
  }

  private void relay(String subject, byte[] payload) {
    JsonNode event = NatsEnvelope.unwrap(json, payload);
    if (event == null) {
      LOG.warn("Notification event on {} carried no payload", subject);
      return;
    }

    Object body = json.convertValue(event, Object.class);
    String room = RealtimeRooms.userRoom(
      NatsEnvelope.stringField(event, "recipientId")
    );

    if (Subjects.NOTIFICATION_REALTIME_CREATED.equals(subject)) {
      relay.relayToRoom(
        room,
        RealtimeEvents.REALTIME_EVENTS_NOTIFICATION_NEW,
        body
      );
    } else if (Subjects.NOTIFICATION_REALTIME_UPDATED.equals(subject)) {
      relay.relayToRoom(
        room,
        RealtimeEvents.REALTIME_EVENTS_NOTIFICATION_UPDATED,
        body
      );
    } else if (Subjects.NOTIFICATION_REALTIME_READ.equals(subject)) {
      // One subject, two emits on the SAME room: the raw event, then a
      // derived/reshaped unread-count payload — not a second raw forward.
      relay.relayToRoom(
        room,
        RealtimeEvents.REALTIME_EVENTS_NOTIFICATION_READ,
        body
      );
      JsonNode unreadCount = event.get("unreadCount");
      if (unreadCount != null) {
        relay.relayToRoom(
          room,
          RealtimeEvents.REALTIME_EVENTS_NOTIFICATION_UNREAD_COUNT,
          Map.of("count", unreadCount.asInt())
        );
      }
    }
  }
}
