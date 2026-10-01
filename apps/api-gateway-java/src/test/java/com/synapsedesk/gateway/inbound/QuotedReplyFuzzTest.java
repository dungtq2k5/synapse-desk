package com.synapsedesk.gateway.inbound;

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
 * {@link QuotedReply}'s HTML stripping, held to the randomized corpus the Node
 * gateway recomputes from its own functions on every run
 * ({@code quoted-reply-fuzz.spec.ts}).
 *
 * <p>The Java implementation scans rather than matching regular expressions, so
 * its time is linear in the input; the corpus is what makes that safe — 900
 * seeded sequences of the tokens the patterns care about, including the case
 * folds where ASCII and Unicode comparison differ. A scanner that is almost the
 * regex is the failure this exists to catch.
 */
class QuotedReplyFuzzTest {

  private static final Path TABLE = Path.of(
    "..",
    "api-gateway",
    "test",
    "fixtures",
    "inbound-email",
    "quoted-reply-fuzz.json"
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

  static Stream<Arguments> rows() {
    List<Arguments> rows = new ArrayList<>();
    int index = 0;
    for (JsonNode row : table()) {
      rows.add(
        Arguments.of(
          index++,
          row.get(0).asString(),
          row.get(1).asString(),
          row.get(2).asString()
        )
      );
    }

    return rows.stream();
  }

  @ParameterizedTest(name = "row {0}")
  @MethodSource("rows")
  void agreesWithNode(int index, String html, String cut, String stored) {
    assertThat(QuotedReply.stripQuotedHtml(html)).isEqualTo(cut);
    assertThat(QuotedReply.toStoredBody(null, html)).isEqualTo(stored);
  }

  @Test
  void theCorpusIsLargeAndTheContainerPatternsReallyCutInIt() {
    int changed = 0;
    for (JsonNode row : table()) {
      if (!row.get(0).asString().equals(row.get(1).asString())) changed++;
    }

    assertThat(table().size()).isGreaterThanOrEqualTo(900);
    assertThat(changed).isGreaterThan(200);
  }
}
