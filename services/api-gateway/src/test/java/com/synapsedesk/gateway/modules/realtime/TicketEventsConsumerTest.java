package com.synapsedesk.gateway.modules.realtime;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.config.StoreProperties;
import com.synapsedesk.gateway.common.contracts.RealtimeEvents;
import com.synapsedesk.gateway.modules.realtime.RealtimeRelay;
import io.nats.client.Message;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

/**
 * The subject-to-room-to-event table, exercised directly through
 * {@link TicketEventsConsumer#onMessage} — the same seam
 * {@code CacheInvalidationConsumerTest} uses, with a mocked
 * {@link RealtimeRelay} standing in for the socket server.
 */
class TicketEventsConsumerTest {

  private static final ObjectMapper JSON = new ObjectMapper();

  private final RealtimeRelay relay = mock(RealtimeRelay.class);
  private final StoreProperties store = new StoreProperties(
    "redis://localhost:6379",
    "nats://localhost:4222"
  );
  private final TicketEventsConsumer consumer = new TicketEventsConsumer(
    store,
    relay,
    mock(com.synapsedesk.gateway.common.metrics.GatewayMetrics.class),
    JSON
  );

  private static Message message(String subject, String json) {
    Message message = mock(Message.class);
    when(message.getSubject()).thenReturn(subject);
    when(message.getData()).thenReturn(json.getBytes(StandardCharsets.UTF_8));
    return message;
  }

  @Test
  void createdRelaysToTheAgentsRoomAndTheAuthorNeverTheWholeTenant() {
    consumer.onMessage(
      message(
        "ticket.created",
        "{\"ticketId\":\"t1\",\"organizationId\":\"o1\",\"authorId\":\"u1\"}"
      )
    );

    // One relay to both rooms: an agent who wrote it gets it once.
    verify(relay).relayToRooms(
      eq(List.of("org:o1:agents", "user:u1")),
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_CREATED),
      any()
    );
    verify(relay, never()).relayToRoom(eq("org:o1"), any(), any());
    verify(relay, never()).relayToRoom(eq("ticket:t1"), any(), any());
  }

  @Test
  void escalatedReachesTheTicketRoomAndTheAgentsNeverTheWholeTenant() {
    consumer.onMessage(
      message(
        "ticket.escalated",
        "{\"ticketId\":\"t1\",\"organizationId\":\"o1\"}"
      )
    );

    verify(relay).relayToRoom(
      eq("ticket:t1"),
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_UPDATED),
      any()
    );
    verify(relay).relayToRoom(
      eq("org:o1:agents"),
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_UPDATED),
      any()
    );
    verify(relay, never()).relayToRoom(eq("org:o1"), any(), any());
  }

  @Test
  void assignedRelaysToTicketRoomUpdatedAndAssigneeAssigned() {
    consumer.onMessage(
      message(
        "ticket.assigned",
        "{\"ticketId\":\"t1\",\"assignedToId\":\"u1\"}"
      )
    );

    verify(relay).relayToRoom(
      eq("ticket:t1"),
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_UPDATED),
      any()
    );
    verify(relay).relayToRoom(
      eq("user:u1"),
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_ASSIGNED),
      any()
    );
  }

  @Test
  void reassignedWithNoPreviousAssigneeSkipsTheThirdRelay() {
    consumer.onMessage(
      message(
        "ticket.reassigned",
        "{\"ticketId\":\"t1\",\"toAssigneeId\":\"u2\"}"
      )
    );

    verify(relay).relayToRoom(
      eq("ticket:t1"),
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_UPDATED),
      any()
    );
    verify(relay).relayToRoom(
      eq("user:u2"),
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_ASSIGNED),
      any()
    );
    // No `fromAssigneeId` in the payload — exactly two relays, not three.
    org.mockito.Mockito.verifyNoMoreInteractions(relay);
  }

  @Test
  void reassignedWithAPreviousAssigneeGetsUpdatedNotAssigned() {
    consumer.onMessage(
      message(
        "ticket.reassigned",
        "{\"ticketId\":\"t1\",\"toAssigneeId\":\"u2\",\"fromAssigneeId\":\"u1\"}"
      )
    );

    verify(relay).relayToRoom(
      eq("user:u2"),
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_ASSIGNED),
      any()
    );
    verify(relay).relayToRoom(
      eq("user:u1"),
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_UPDATED),
      any()
    );
    // The old assignee never gets `ticketAssigned` — only the new one does.
    verify(relay, never()).relayToRoom(
      eq("user:u1"),
      eq(RealtimeEvents.REALTIME_EVENTS_TICKET_ASSIGNED),
      any()
    );
  }

  @Test
  void anInternalMessageGoesToTheInternalRoomOnly() {
    consumer.onMessage(
      message(
        "ticket.message_created",
        "{\"ticketId\":\"t1\",\"isInternalNote\":true}"
      )
    );

    verify(relay).relayToRoom(
      eq("ticket:t1:internal"),
      eq(RealtimeEvents.REALTIME_EVENTS_MESSAGE_NEW),
      any()
    );
    verify(relay, never()).relayToRoom(
      eq("ticket:t1"),
      eq(RealtimeEvents.REALTIME_EVENTS_MESSAGE_NEW),
      any()
    );
  }

  @Test
  void aPublicMessageGoesToTheTicketRoom() {
    consumer.onMessage(
      message(
        "ticket.message_created",
        "{\"ticketId\":\"t1\",\"isInternalNote\":false}"
      )
    );

    verify(relay).relayToRoom(
      eq("ticket:t1"),
      eq(RealtimeEvents.REALTIME_EVENTS_MESSAGE_NEW),
      any()
    );
  }

  @Test
  void aRedactedMessageForwardsTheEventUnmodified() {
    consumer.onMessage(
      message(
        "ticket.message_redacted",
        "{\"ticketId\":\"t1\",\"isInternalNote\":false}"
      )
    );

    verify(relay).relayToRoom(
      eq("ticket:t1"),
      eq(RealtimeEvents.REALTIME_EVENTS_MESSAGE_DELETED),
      any()
    );
  }

  @Test
  void aMalformedPayloadIsSwallowedNotThrown() {
    consumer.onMessage(message("ticket.created", "not json"));

    verify(relay, never()).relayToRoom(any(), any(), any());
  }
}
