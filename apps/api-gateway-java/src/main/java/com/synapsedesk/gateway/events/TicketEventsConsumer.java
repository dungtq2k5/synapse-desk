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
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * `TicketEventsConsumer`, reproduced — this is the row that proves or
 * disproves the no-queue-group decision: with two replicas subscribed to the
 * same NATS subject and no queue group, EVERY replica receives EVERY
 * `ticket.*` event, so a client in `ticket:{id}` must get exactly one frame
 * per event regardless of which replica delivered it. {@link RealtimeRelay}
 * is what makes that true — it never calls the store-publishing convenience
 * method, only per-client `sendEvent` on this replica's own local room
 * members.
 *
 * <p><b>`@Order(10)`, after {@code RealtimeGateway}'s `0`.</b> Activating
 * after the socket server means this consumer can only ever relay to sockets
 * that already exist; deactivating BEFORE it (the composite's reverse order)
 * means "stop consuming, then drop sockets" — a relay never fires into a
 * room whose sockets are mid-teardown.
 */
@Component
@Order(10)
public class TicketEventsConsumer implements LeaseParticipant {

  private static final Logger LOG = LoggerFactory.getLogger(
    TicketEventsConsumer.class
  );

  private static final List<String> SUBJECTS = List.of(
    Subjects.TICKET_CREATED,
    Subjects.TICKET_ASSIGNED,
    Subjects.TICKET_REASSIGNED,
    Subjects.TICKET_UNASSIGNED,
    Subjects.TICKET_STATUS_CHANGED,
    Subjects.TICKET_ESCALATED,
    Subjects.TICKET_MESSAGE_CREATED,
    Subjects.TICKET_MESSAGE_UPDATED,
    Subjects.TICKET_MESSAGE_REDACTED
  );

  private final StoreProperties store;
  private final RealtimeRelay relay;
  private final GatewayMetrics metrics;
  private final ObjectMapper json;

  private volatile Connection connection;

  public TicketEventsConsumer(
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
      connection = opened;
      LOG.info(
        "Ticket events consumer subscribed to {} subjects",
        SUBJECTS.size()
      );
    } catch (InterruptedException failure) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(
        "Could not start the ticket events consumer",
        failure
      );
    } catch (IOException failure) {
      throw new IllegalStateException(
        "Could not start the ticket events consumer",
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
      LOG.warn("Ticket event on {} carried no payload", subject);
      return;
    }

    Object body = json.convertValue(event, Object.class);
    String ticketId = NatsEnvelope.stringField(event, "ticketId");

    if (Subjects.TICKET_CREATED.equals(subject)) {
      relay.relayToRoom(
        RealtimeRooms.orgRoom(NatsEnvelope.organizationIdOf(event)),
        RealtimeEvents.REALTIME_EVENTS_TICKET_CREATED,
        body
      );
    } else if (Subjects.TICKET_ASSIGNED.equals(subject)) {
      relay.relayToRoom(
        RealtimeRooms.ticketRoom(ticketId),
        RealtimeEvents.REALTIME_EVENTS_TICKET_UPDATED,
        body
      );
      relay.relayToRoom(
        RealtimeRooms.userRoom(NatsEnvelope.stringField(event, "assignedToId")),
        RealtimeEvents.REALTIME_EVENTS_TICKET_ASSIGNED,
        body
      );
    } else if (Subjects.TICKET_REASSIGNED.equals(subject)) {
      relay.relayToRoom(
        RealtimeRooms.ticketRoom(ticketId),
        RealtimeEvents.REALTIME_EVENTS_TICKET_UPDATED,
        body
      );
      relay.relayToRoom(
        RealtimeRooms.userRoom(NatsEnvelope.stringField(event, "toAssigneeId")),
        RealtimeEvents.REALTIME_EVENTS_TICKET_ASSIGNED,
        body
      );
      // The OLD assignee gets `ticketUpdated`, deliberately not
      // `ticketAssigned` — they were not just assigned anything.
      String fromAssigneeId = NatsEnvelope.stringField(event, "fromAssigneeId");
      if (fromAssigneeId != null) {
        relay.relayToRoom(
          RealtimeRooms.userRoom(fromAssigneeId),
          RealtimeEvents.REALTIME_EVENTS_TICKET_UPDATED,
          body
        );
      }
    } else if (Subjects.TICKET_UNASSIGNED.equals(subject)) {
      relay.relayToRoom(
        RealtimeRooms.ticketRoom(ticketId),
        RealtimeEvents.REALTIME_EVENTS_TICKET_UPDATED,
        body
      );
      relay.relayToRoom(
        RealtimeRooms.userRoom(
          NatsEnvelope.stringField(event, "previousAssigneeId")
        ),
        RealtimeEvents.REALTIME_EVENTS_TICKET_UPDATED,
        body
      );
    } else if (Subjects.TICKET_STATUS_CHANGED.equals(subject)) {
      relay.relayToRoom(
        RealtimeRooms.ticketRoom(ticketId),
        RealtimeEvents.REALTIME_EVENTS_TICKET_UPDATED,
        body
      );
    } else if (Subjects.TICKET_ESCALATED.equals(subject)) {
      relay.relayToRoom(
        RealtimeRooms.ticketRoom(ticketId),
        RealtimeEvents.REALTIME_EVENTS_TICKET_UPDATED,
        body
      );
      relay.relayToRoom(
        RealtimeRooms.orgRoom(NatsEnvelope.organizationIdOf(event)),
        RealtimeEvents.REALTIME_EVENTS_TICKET_UPDATED,
        body
      );
    } else if (Subjects.TICKET_MESSAGE_CREATED.equals(subject)) {
      relay.relayToRoom(
        messageRoom(event, ticketId),
        RealtimeEvents.REALTIME_EVENTS_MESSAGE_NEW,
        body
      );
    } else if (Subjects.TICKET_MESSAGE_UPDATED.equals(subject)) {
      relay.relayToRoom(
        messageRoom(event, ticketId),
        RealtimeEvents.REALTIME_EVENTS_MESSAGE_UPDATED,
        body
      );
    } else if (Subjects.TICKET_MESSAGE_REDACTED.equals(subject)) {
      // Payload forwarded UNMODIFIED — a redaction never adds content, so
      // there is nothing here for this consumer to strip.
      relay.relayToRoom(
        messageRoom(event, ticketId),
        RealtimeEvents.REALTIME_EVENTS_MESSAGE_DELETED,
        body
      );
    }
  }

  /** `ticket:{id}:internal` for an internal note, `ticket:{id}` otherwise. */
  private static String messageRoom(JsonNode event, String ticketId) {
    JsonNode internal = event.get("isInternalNote");
    boolean isInternalNote = internal != null && internal.asBoolean();

    return isInternalNote
      ? RealtimeRooms.ticketInternalRoom(ticketId)
      : RealtimeRooms.ticketRoom(ticketId);
  }
}
