package com.synapsedesk.gateway.modules.inboundemail;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.modules.inboundemail.ResendInboundMapper.Capped;
import com.synapsedesk.gateway.modules.inboundemail.ResendPayloads.Email;
import com.synapsedesk.gateway.modules.inboundemail.ResendPayloads.Event;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The inbound body cap, held to the fixed table
 * {@code test/fixtures/inbound-email/body-cap-parity.json}, plus the mapper's use
 * of it and the property it exists for.
 *
 * <p>The cap is applied where the fetched mail enters, because the patterns that
 * strip quoted history and HTML are quadratic on a body of unclosed tags. The key
 * hashed from the body depends on exactly where the cut lands.
 */
class InboundBodyCapParityTest {

  private static final int MAX = InboundLimits.MAX_INBOUND_BODY_LENGTH;
  private static final Path TABLE = Path.of(
    "..",
    "..",
    "test",
    "fixtures",
    "inbound-email",
    "body-cap-parity.json"
  );

  private static JsonNode table() {
    try {
      return JsonMapper.builder().build().readTree(Files.readString(TABLE));
    } catch (IOException failure) {
      throw new IllegalStateException(
        "could not read " + TABLE.toAbsolutePath(),
        failure
      );
    }
  }

  private static String build(JsonNode pieces) {
    if (pieces.isNull()) return null;
    StringBuilder body = new StringBuilder();
    for (JsonNode piece : pieces) {
      body.append(piece.get(0).asString().repeat(piece.get(1).asInt()));
    }

    return body.toString();
  }

  static Stream<Arguments> rows() {
    List<Arguments> rows = new ArrayList<>();
    int index = 0;
    for (JsonNode row : table().get("rows")) {
      rows.add(Arguments.of(index++, row.get(0), row.get(1)));
    }

    return rows.stream();
  }

  @Test
  void theTableWasComputedForThisConstant() {
    assertThat(table().get("max").asInt()).isEqualTo(MAX);
  }

  @ParameterizedTest(name = "row {0}")
  @MethodSource("rows")
  void isCutTheWayTheTableSays(int index, JsonNode pieces, JsonNode expected) {
    Capped result = ResendInboundMapper.capBody(build(pieces));

    if (expected.isNull()) {
      assertThat(result).isEqualTo(new Capped(null, false));

      return;
    }
    String value = result.value();
    assertThat(value).hasSize(expected.get("length").asInt());
    assertThat(value.substring(Math.max(0, value.length() - 4))).isEqualTo(
      expected.get("tail").asString()
    );
    assertThat(result.truncated()).isEqualTo(
      expected.get("truncated").asBoolean()
    );
  }

  @Test
  void theTableIncludesTheBoundaryAndEverySurrogateCase() {
    int truncated = 0;
    int atBoundary = 0;
    boolean tornPair = false;
    for (JsonNode row : table().get("rows")) {
      JsonNode expected = row.get(1);
      if (expected.isNull()) continue;
      if (expected.get("truncated").asBoolean()) truncated++;
      int length = expected.get("length").asInt();
      if (length == MAX - 1 || length == MAX) atBoundary++;
      String input = build(row.get(0));
      if (
        expected.get("truncated").asBoolean() &&
        length == MAX - 1 &&
        input != null &&
        Character.isHighSurrogate(input.charAt(MAX - 1)) &&
        Character.isLowSurrogate(input.charAt(MAX))
      ) {
        tornPair = true;
      }
    }

    assertThat(table().get("rows").size()).isGreaterThanOrEqualTo(25);
    assertThat(truncated).isGreaterThanOrEqualTo(10);
    assertThat(atBoundary).isGreaterThanOrEqualTo(3);
    assertThat(tornPair)
      .as("a row where the cut would have torn an astral character in two")
      .isTrue();
  }

  @Test
  void anAbsentFlagMeansTheBodyWasNotCutAndIsNeverNull() {
    // A fixture that omits the key, and a caller that does not say, both mean it
    // was not: the accept path unboxes this, so null would be an NPE on a mail.
    InboundEmail email = new InboundEmail(
      null,
      "to",
      "from@x.test",
      null,
      "s",
      "t",
      null,
      null,
      List.of(),
      null,
      List.of(),
      List.of(),
      List.of(),
      null,
      "2026-10-01T09:00:00.000Z",
      null
    );

    assertThat(email.bodyTruncated()).isNotNull().isFalse();
  }

  // ----------------------------------------------------------- the mapper

  private static Event event() {
    return new Event(
      "email.received",
      "2026-10-01T09:00:00.000Z",
      new Event.Data("e1", List.of("support@inbound.test"))
    );
  }

  private static Email mail(String text, String html) {
    return new Email(
      "customer@acme.test",
      "Help",
      text,
      html,
      "<m@x>",
      List.of("support@inbound.test"),
      Map.of(),
      List.of()
    );
  }

  @Test
  void theMapperCapsBothPartsAndSaysSo() {
    InboundEmail mapped = ResendInboundMapper.toMapped(
      event(),
      mail("t".repeat(MAX + 1), "h".repeat(MAX)),
      "inbound.test"
    ).fields();

    assertThat(mapped.text()).hasSize(MAX);
    assertThat(mapped.html()).hasSize(MAX);
    assertThat(mapped.bodyTruncated()).isTrue();
  }

  @Test
  void aBodyAtTheLimitIsReadWholeAndNothingIsSaid() {
    InboundEmail mapped = ResendInboundMapper.toMapped(
      event(),
      mail("t".repeat(MAX), null),
      "inbound.test"
    ).fields();

    assertThat(mapped.text()).hasSize(MAX);
    assertThat(mapped.html()).isNull();
    assertThat(mapped.bodyTruncated()).isFalse();
  }

  @Test
  void aBodyCutInEitherPartAloneIsFlagged() {
    InboundEmail mapped = ResendInboundMapper.toMapped(
      event(),
      mail(null, "h".repeat(MAX + 1)),
      "inbound.test"
    ).fields();

    assertThat(mapped.bodyTruncated()).isTrue();
    assertThat(mapped.text()).isNull();
  }

  @Test
  void aHostileBodyIsProcessedInBoundedTimeHoweverLargeTheMail() {
    // 600 000 characters of unclosed tags: capped at the mapper, then read by
    // scanners whose time is linear. (Both are bounds on the ORDER, not a
    // benchmark; `QuotedReplyTest` proves the scanners' linearity without a cap.)
    String hostile = "<p>" + "<div ".repeat(120_000);
    InboundEmail mapped = ResendInboundMapper.toMapped(
      event(),
      mail(null, hostile),
      "inbound.test"
    ).fields();

    Assertions.assertTimeoutPreemptively(Duration.ofSeconds(5), () ->
      QuotedReply.toStoredBody(mapped.text(), mapped.html())
    );
  }
}
