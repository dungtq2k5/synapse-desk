package com.synapsedesk.gateway.modules.inboundemail;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@link QuotedReply}, held to the fixed table
 * {@code test/fixtures/inbound-email/quoted-reply-parity.json}.
 *
 * <p>The table is the one fact; this file only reads it. Its rows are the awkward
 * inputs — {@code \r\n}, bare {@code \r}, {@code U+2028}, non-breaking spaces,
 * unterminated tags — where a Java regex that merely looks like the JS one would
 * answer differently.
 */
class QuotedReplyParityTest {

  private static final Path TABLE = Path.of(
    "..",
    "..",
    "test",
    "fixtures",
    "inbound-email",
    "quoted-reply-parity.json"
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

  private static String text(JsonNode node) {
    return node.isNull() ? null : node.asString();
  }

  private static Stream<Arguments> rows(String kind, int width) {
    List<Arguments> rows = new ArrayList<>();
    for (JsonNode row : table().get(kind)) {
      Object[] cells = new Object[width];
      for (int i = 0; i < width; i++) cells[i] = text(row.get(i));
      rows.add(Arguments.of(cells));
    }

    return rows.stream();
  }

  static Stream<Arguments> replies() {
    return rows("reply", 2);
  }

  static Stream<Arguments> htmls() {
    return rows("html", 2);
  }

  static Stream<Arguments> stored() {
    return rows("stored", 3);
  }

  @ParameterizedTest(name = "stripQuotedReply({0})")
  @MethodSource("replies")
  void replyAgreesWithNode(String input, String expected) {
    assertThat(QuotedReply.stripQuotedReply(input)).isEqualTo(expected);
  }

  @ParameterizedTest(name = "stripQuotedHtml({0})")
  @MethodSource("htmls")
  void htmlAgreesWithNode(String input, String expected) {
    assertThat(QuotedReply.stripQuotedHtml(input)).isEqualTo(expected);
  }

  @ParameterizedTest(name = "toStoredBody({0}, {1})")
  @MethodSource("stored")
  void storedBodyAgreesWithNode(String text, String html, String expected) {
    assertThat(QuotedReply.toStoredBody(text, html)).isEqualTo(expected);
  }

  @Test
  void theTableIsLargeEnoughAndSometimesChangesTheInput() {
    // A table of rows the function leaves alone would be satisfied by identity.
    int changed = 0;
    for (JsonNode row : table().get("reply")) {
      if (!row.get(0).asString().equals(row.get(1).asString())) changed++;
    }

    assertThat(table().get("reply").size()).isGreaterThanOrEqualTo(50);
    assertThat(table().get("html").size()).isGreaterThanOrEqualTo(15);
    assertThat(table().get("stored").size()).isGreaterThanOrEqualTo(25);
    assertThat(changed).isGreaterThanOrEqualTo(25);
  }
}
