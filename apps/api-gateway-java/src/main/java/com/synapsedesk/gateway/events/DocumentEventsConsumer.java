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
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** `DocumentEventsConsumer`, reproduced — see {@link TicketEventsConsumer} for the shared reasoning. */
@Component
@Order(10)
public class DocumentEventsConsumer implements LeaseParticipant {

  private static final Logger LOG = LoggerFactory.getLogger(
    DocumentEventsConsumer.class
  );

  private static final List<String> SUBJECTS = List.of(
    Subjects.DOCUMENT_INDEXED,
    Subjects.DOCUMENT_INGESTION_FAILED
  );

  private final StoreProperties store;
  private final RealtimeRelay relay;
  private final GatewayMetrics metrics;
  private final ObjectMapper json;

  private volatile Connection connection;

  public DocumentEventsConsumer(
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
        "Document events consumer subscribed to {} subjects",
        SUBJECTS.size()
      );
    } catch (InterruptedException failure) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(
        "Could not start the document events consumer",
        failure
      );
    } catch (IOException failure) {
      throw new IllegalStateException(
        "Could not start the document events consumer",
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
      LOG.warn("Document event on {} carried no payload", subject);
      return;
    }

    Object body = json.convertValue(event, Object.class);

    if (Subjects.DOCUMENT_INDEXED.equals(subject)) {
      relay.relayToRooms(
        audience(event),
        RealtimeEvents.REALTIME_EVENTS_DOCUMENT_INDEXED,
        body
      );
    } else if (Subjects.DOCUMENT_INGESTION_FAILED.equals(subject)) {
      // Uploader only, never department-wide — a failure is theirs to see.
      relay.relayToRoom(
        RealtimeRooms.userRoom(NatsEnvelope.stringField(event, "uploaderId")),
        RealtimeEvents.REALTIME_EVENTS_DOCUMENT_FAILED,
        body
      );
    }
  }

  /**
   * Always the uploader; then either the whole org (organization-wide) or
   * one room per department — never both, matching the Node helper's early
   * return once the event is marked organization-wide.
   */
  private static List<String> audience(JsonNode event) {
    Set<String> rooms = new LinkedHashSet<>();
    rooms.add(
      RealtimeRooms.userRoom(NatsEnvelope.stringField(event, "uploaderId"))
    );

    JsonNode organizationWide = event.get("isOrganizationWide");
    if (organizationWide != null && organizationWide.asBoolean()) {
      rooms.add(RealtimeRooms.orgRoom(NatsEnvelope.organizationIdOf(event)));
      return new ArrayList<>(rooms);
    }

    JsonNode departmentIds = event.get("departmentIds");
    if (departmentIds != null && departmentIds.isArray()) {
      for (JsonNode departmentId : departmentIds) {
        rooms.add(RealtimeRooms.deptRoom(departmentId.asString()));
      }
    }

    return new ArrayList<>(rooms);
  }
}
