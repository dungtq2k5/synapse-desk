package com.synapsedesk.gateway.modules.realtime;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.config.StoreProperties;
import com.synapsedesk.gateway.common.contracts.RealtimeEvents;
import io.nats.client.Message;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class DocumentEventsConsumerTest {

  private static final ObjectMapper JSON = new ObjectMapper();

  private final RealtimeRelay relay = mock(RealtimeRelay.class);
  private final DocumentEventsConsumer consumer = new DocumentEventsConsumer(
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
  void organizationWideIndexedRelaysToUploaderAndOrgOnly() {
    consumer.onMessage(
      message(
        "document.indexed",
        "{\"uploaderId\":\"u1\",\"organizationId\":\"o1\",\"isOrganizationWide\":true,\"departmentIds\":[\"d1\"]}"
      )
    );

    verify(relay).relayToRooms(
      eq(List.of("user:u1", "org:o1")),
      eq(RealtimeEvents.REALTIME_EVENTS_DOCUMENT_INDEXED),
      any()
    );
  }

  @Test
  void departmentScopedIndexedRelaysToUploaderAndEachDepartment() {
    consumer.onMessage(
      message(
        "document.indexed",
        "{\"uploaderId\":\"u1\",\"isOrganizationWide\":false,\"departmentIds\":[\"d1\",\"d2\"]}"
      )
    );

    verify(relay).relayToRooms(
      eq(List.of("user:u1", "dept:d1", "dept:d2")),
      eq(RealtimeEvents.REALTIME_EVENTS_DOCUMENT_INDEXED),
      any()
    );
  }

  @Test
  void ingestionFailedRelaysToTheUploaderOnly() {
    consumer.onMessage(
      message("document.ingestion_failed", "{\"uploaderId\":\"u1\"}")
    );

    verify(relay).relayToRoom(
      eq("user:u1"),
      eq(RealtimeEvents.REALTIME_EVENTS_DOCUMENT_FAILED),
      any()
    );
    verify(relay, never()).relayToRooms(any(), any(), any());
  }
}
