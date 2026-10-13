package com.synapsedesk.gateway.common.cache;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.synapsedesk.gateway.common.config.StoreProperties;
import io.nats.client.Message;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

/**
 * `CacheInvalidationConsumer`'s pure logic — the subject-to-scope table, the
 * Nest envelope unwrap, and each property the consumer documents. No
 * real NATS connection: {@link CacheInvalidationConsumer#onMessage} and
 * {@link CacheInvalidationConsumer#organizationIdOf} are exercised directly,
 * the same seam `CacheInvalidationConsumerIT` uses for the real-connection
 * half.
 */
class CacheInvalidationConsumerTest {

  private static final ObjectMapper JSON = new ObjectMapper();

  private final CacheService cache = mock(CacheService.class);
  private final StoreProperties store = new StoreProperties(
    "redis://localhost:6379",
    "nats://localhost:4222"
  );
  private final CacheInvalidationConsumer consumer =
    new CacheInvalidationConsumer(store, cache, JSON);

  @Test
  void everyTicketPatternDropsTheTicketsScope() {
    List<String> ticketSubjects = List.of(
      "ticket.created",
      "ticket.escalated",
      "ticket.assigned",
      "ticket.reassigned",
      "ticket.unassigned",
      "ticket.status_changed",
      "ticket.message_created",
      "ticket.message_updated",
      "ticket.message_redacted"
    );

    assertThat(CacheInvalidationConsumer.SUBJECT_SCOPES.keySet()).containsAll(
      ticketSubjects
    );
    for (String subject : ticketSubjects) {
      assertThat(
        CacheInvalidationConsumer.SUBJECT_SCOPES.get(subject)
      ).containsExactly("tickets");
    }
  }

  @Test
  void documentUploadedIsDeliberatelyAbsentFromTheSubscribedSet() {
    assertThat(CacheInvalidationConsumer.SUBJECT_SCOPES).doesNotContainKey(
      "document.uploaded"
    );
    assertThat(
      CacheInvalidationConsumer.SUBJECT_SCOPES.get("document.indexed")
    ).containsExactly("documents");
    assertThat(
      CacheInvalidationConsumer.SUBJECT_SCOPES.get("document.ingestion_failed")
    ).containsExactly("documents");
    assertThat(
      CacheInvalidationConsumer.SUBJECT_SCOPES.get("document.scope_changed")
    ).containsExactly("documents");
  }

  @Test
  void entitlementsChangedDropsBothSettingsAndOrganizations() {
    assertThat(
      CacheInvalidationConsumer.SUBJECT_SCOPES.get(
        "billing.entitlements_changed"
      )
    ).containsExactlyInAnyOrder("settings", "organizations");
  }

  @Test
  void aRawPayloadWithNoEnvelopeIsReadAsTheEventItself() {
    byte[] payload = "{\"organizationId\":\"org-1\"}".getBytes(
      StandardCharsets.UTF_8
    );

    assertThat(
      CacheInvalidationConsumer.organizationIdOf(JSON, payload)
    ).isEqualTo("org-1");
  }

  @Test
  void aNestEnvelopeWithPatternAndDataIsUnwrappedToItsDataField() {
    byte[] payload =
      "{\"pattern\":\"ticket.created\",\"data\":{\"organizationId\":\"org-2\",\"pattern\":\"ticket.created\"}}".getBytes(
        StandardCharsets.UTF_8
      );

    assertThat(
      CacheInvalidationConsumer.organizationIdOf(JSON, payload)
    ).isEqualTo("org-2");
  }

  @Test
  void aTenantlessEventReturnsNullRatherThanThrowing() {
    byte[] payload = "{\"ticketId\":\"t-1\"}".getBytes(StandardCharsets.UTF_8);

    assertThat(
      CacheInvalidationConsumer.organizationIdOf(JSON, payload)
    ).isNull();
  }

  @Test
  void malformedJsonReturnsNullRatherThanThrowing() {
    byte[] payload = "not json".getBytes(StandardCharsets.UTF_8);

    assertThat(
      CacheInvalidationConsumer.organizationIdOf(JSON, payload)
    ).isNull();
  }

  @Test
  void onMessageDropsTheMappedScopeForTheEventsTenant() {
    Message message = mock(Message.class);
    when(message.getSubject()).thenReturn("ticket.created");
    when(message.getData()).thenReturn(
      "{\"pattern\":\"ticket.created\",\"data\":{\"organizationId\":\"org-3\"}}".getBytes(
        StandardCharsets.UTF_8
      )
    );
    when(cache.invalidateScope(anyString(), anyString())).thenReturn(0);

    consumer.onMessage(message);

    verify(cache).invalidateScope(eq("org-3"), eq("tickets"));
  }

  @Test
  void onMessageDropsBothScopesForEntitlementsChanged() {
    Message message = mock(Message.class);
    when(message.getSubject()).thenReturn("billing.entitlements_changed");
    when(message.getData()).thenReturn(
      "{\"pattern\":\"billing.entitlements_changed\",\"data\":{\"organizationId\":\"org-4\"}}".getBytes(
        StandardCharsets.UTF_8
      )
    );
    when(cache.invalidateScope(anyString(), anyString())).thenReturn(0);

    consumer.onMessage(message);

    verify(cache).invalidateScope(eq("org-4"), eq("settings"));
    verify(cache).invalidateScope(eq("org-4"), eq("organizations"));
  }

  @Test
  void onMessageSkipsAnUnsubscribedSubjectEntirely() {
    Message message = mock(Message.class);
    when(message.getSubject()).thenReturn("document.uploaded");

    consumer.onMessage(message);

    verify(cache, never()).invalidateScope(any(), any());
  }

  @Test
  void onMessageForATenantlessEventNeverCallsInvalidate() {
    Message message = mock(Message.class);
    when(message.getSubject()).thenReturn("ticket.created");
    when(message.getData()).thenReturn(
      "{\"ticketId\":\"t-1\"}".getBytes(StandardCharsets.UTF_8)
    );

    consumer.onMessage(message);

    verify(cache, never()).invalidateScope(any(), any());
  }

  @Test
  void aCacheFailureDuringDropDoesNotEscapeOnMessage() {
    Message message = mock(Message.class);
    when(message.getSubject()).thenReturn("ticket.created");
    when(message.getData()).thenReturn(
      "{\"organizationId\":\"org-5\"}".getBytes(StandardCharsets.UTF_8)
    );
    when(cache.invalidateScope(anyString(), anyString())).thenThrow(
      new RuntimeException("redis down")
    );

    consumer.onMessage(message);
  }
}
