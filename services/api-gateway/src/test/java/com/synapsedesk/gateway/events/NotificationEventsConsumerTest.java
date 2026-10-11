package com.synapsedesk.gateway.events;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.config.StoreProperties;
import com.synapsedesk.gateway.common.contracts.RealtimeEvents;
import com.synapsedesk.gateway.realtime.RealtimeRelay;
import io.nats.client.Message;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class NotificationEventsConsumerTest {

  private static final ObjectMapper JSON = new ObjectMapper();

  private final RealtimeRelay relay = mock(RealtimeRelay.class);
  private final NotificationEventsConsumer consumer =
    new NotificationEventsConsumer(
      new StoreProperties("redis://localhost:6379", "nats://localhost:4222"),
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
  void createdRelaysToTheRecipientOnly() {
    consumer.onMessage(
      message("notification.created", "{\"recipientId\":\"u1\"}")
    );

    verify(relay).relayToRoom(
      eq("user:u1"),
      eq(RealtimeEvents.REALTIME_EVENTS_NOTIFICATION_NEW),
      any()
    );
  }

  @Test
  void readEmitsBothTheRawEventAndTheDerivedUnreadCount() {
    consumer.onMessage(
      message("notification.read", "{\"recipientId\":\"u1\",\"unreadCount\":3}")
    );

    verify(relay).relayToRoom(
      eq("user:u1"),
      eq(RealtimeEvents.REALTIME_EVENTS_NOTIFICATION_READ),
      any()
    );
    verify(relay).relayToRoom(
      eq("user:u1"),
      eq(RealtimeEvents.REALTIME_EVENTS_NOTIFICATION_UNREAD_COUNT),
      eq(Map.of("count", 3))
    );
    verify(relay, times(2)).relayToRoom(eq("user:u1"), any(), any());
  }
}
