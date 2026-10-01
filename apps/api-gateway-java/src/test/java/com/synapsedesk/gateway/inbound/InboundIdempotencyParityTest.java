package com.synapsedesk.gateway.inbound;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@link InboundEmailService#idempotencyKeyFor}, held to the table the Node
 * gateway recomputes from its own private method on every run
 * ({@code idempotency-parity.spec.ts}).
 *
 * <p>The key is a digest, so a string that JavaScript and Java see differently —
 * a lone surrogate, a combining mark, a no-break space — is a different key, and
 * a redelivery that lands on the other gateway during a cutover would create a
 * duplicate ticket instead of being recognised.
 */
class InboundIdempotencyParityTest {

  private static final Path TABLE = Path.of(
    "..",
    "api-gateway",
    "test",
    "fixtures",
    "inbound-email",
    "idempotency-parity.json"
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

  static Stream<Arguments> rows() {
    List<Arguments> rows = new ArrayList<>();
    for (JsonNode row : table()) {
      JsonNode input = row.get(0);
      rows.add(
        Arguments.of(
          new InboundEmail(
            text(input.get("messageId")),
            "support+a1b2c3d4e5f60718293a4b5c6d7e8f90@inbound.test",
            input.get("from").asString(),
            null,
            input.get("subject").asString(),
            text(input.get("text")),
            text(input.get("html")),
            null,
            List.of(),
            null,
            List.of(),
            List.of(),
            List.of(),
            text(input.get("date")),
            "2026-10-01T09:00:00.000Z"
          ),
          row.get(1).asString()
        )
      );
    }

    return rows.stream();
  }

  @ParameterizedTest(name = "row {index}")
  @MethodSource("rows")
  void keyAgreesWithNode(InboundEmail email, String expected) {
    assertThat(InboundEmailService.idempotencyKeyFor(email)).isEqualTo(
      expected
    );
  }

  @Test
  void theTableCoversTheIdentityHazardsAndBothKeyShapes() {
    Set<String> distinct = new HashSet<>();
    int synthesized = 0;
    int verbatim = 0;
    boolean loneSurrogate = false;
    for (JsonNode row : table()) {
      String key = row.get(1).asString();
      distinct.add(key);
      if (key.startsWith("synthesized:")) synthesized++;
      else verbatim++;
      String subject = row.get(0).get("subject").asString();
      for (int i = 0; i < subject.length(); i++) {
        char c = subject.charAt(i);
        boolean high = Character.isHighSurrogate(c);
        boolean low = Character.isLowSurrogate(c);
        if (
          (high &&
            (i + 1 >= subject.length() ||
              !Character.isLowSurrogate(subject.charAt(i + 1)))) ||
          (low && (i == 0 || !Character.isHighSurrogate(subject.charAt(i - 1))))
        ) {
          loneSurrogate = true;
        }
      }
    }

    assertThat(table().size()).isGreaterThanOrEqualTo(40);
    assertThat(synthesized).isGreaterThanOrEqualTo(25);
    assertThat(verbatim).isGreaterThanOrEqualTo(4);
    assertThat(distinct.size()).isGreaterThanOrEqualTo(25);
    assertThat(loneSurrogate)
      .as(
        "a row whose subject holds a lone surrogate, read as the Java test sees it"
      )
      .isTrue();
  }
}
