package com.synapsedesk.gateway.events;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The Nest envelope unwrap, shared by every NATS consumer this gateway has
 * (cache invalidation, and now the three realtime relays). See the class
 * docblock for why it moved here.
 */
class NatsEnvelopeTest {

  private static final ObjectMapper JSON = new ObjectMapper();

  @Test
  void aRawPayloadWithNoEnvelopeIsReadAsTheEventItself() {
    byte[] payload = "{\"ticketId\":\"t-1\"}".getBytes(StandardCharsets.UTF_8);

    JsonNode event = NatsEnvelope.unwrap(JSON, payload);

    assertThat(event.get("ticketId").asString()).isEqualTo("t-1");
  }

  @Test
  void aNestEnvelopeWithPatternAndDataIsUnwrappedToItsDataField() {
    byte[] payload =
      "{\"pattern\":\"ticket.created\",\"data\":{\"ticketId\":\"t-2\"}}".getBytes(
        StandardCharsets.UTF_8
      );

    JsonNode event = NatsEnvelope.unwrap(JSON, payload);

    assertThat(event.get("ticketId").asString()).isEqualTo("t-2");
  }

  @Test
  void malformedJsonUnwrapsToNullRatherThanThrowing() {
    assertThat(
      NatsEnvelope.unwrap(JSON, "not json".getBytes(StandardCharsets.UTF_8))
    ).isNull();
  }

  @Test
  void organizationIdOfReadsTheStringField() {
    JsonNode event = NatsEnvelope.unwrap(
      JSON,
      "{\"organizationId\":\"org-1\"}".getBytes(StandardCharsets.UTF_8)
    );

    assertThat(NatsEnvelope.organizationIdOf(event)).isEqualTo("org-1");
  }

  @Test
  void organizationIdOfIsNullOnANullEvent() {
    assertThat(NatsEnvelope.organizationIdOf(null)).isNull();
  }

  @Test
  void stringFieldIsNullWhenTheFieldIsAbsentOrNotAString() {
    JsonNode event = NatsEnvelope.unwrap(
      JSON,
      "{\"count\":5}".getBytes(StandardCharsets.UTF_8)
    );

    assertThat(NatsEnvelope.stringField(event, "missing")).isNull();
    assertThat(NatsEnvelope.stringField(event, "count")).isNull();
  }
}
