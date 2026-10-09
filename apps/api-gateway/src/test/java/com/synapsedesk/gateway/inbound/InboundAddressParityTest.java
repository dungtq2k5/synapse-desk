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
 * {@link InboundAddress} and {@link TicketReplyToken}, held to the fixed table
 * {@code test/fixtures/inbound-email/address-parity.json}.
 *
 * <p>The table is the one fact; this file only reads it. It includes the rows
 * where a faithful port and a "sensible" one disagree — a MAC with trailing
 * garbage, an upper-case number, a sign, a hex prefix — because those are the
 * rows a tidy-up would break.
 */
class InboundAddressParityTest {

  private static final Path TABLE = Path.of(
    "..",
    "..",
    "test",
    "fixtures",
    "inbound-email",
    "address-parity.json"
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

  static Stream<Arguments> addresses() {
    List<Arguments> rows = new ArrayList<>();
    for (JsonNode row : table().get("address")) {
      JsonNode expected = row.get(1);
      rows.add(
        Arguments.of(
          row.get(0).asString(),
          expected.isNull() ? null : expected.get("tenantToken").asString(),
          expected.isNull() || expected.get("ticketToken").isNull()
            ? null
            : expected.get("ticketToken").asString()
        )
      );
    }

    return rows.stream();
  }

  static Stream<Arguments> tokens() {
    List<Arguments> rows = new ArrayList<>();
    for (JsonNode row : table().get("token")) {
      rows.add(
        Arguments.of(
          row.get(0).asString(),
          row.get(1).asString(),
          row.get(2).asString(),
          row.get(3).isNull() ? null : row.get(3).asLong()
        )
      );
    }

    return rows.stream();
  }

  @ParameterizedTest(name = "parse({0})")
  @MethodSource("addresses")
  void addressAgreesWithNode(String input, String tenant, String ticket) {
    InboundAddress parsed = InboundAddress.parse(input);

    if (tenant == null) {
      assertThat(parsed).isNull();
    } else {
      assertThat(parsed).isEqualTo(new InboundAddress(tenant, ticket));
    }
  }

  @ParameterizedTest(name = "parse({0}, {1})")
  @MethodSource("tokens")
  void tokenAgreesWithNode(
    String token,
    String organizationId,
    String secret,
    Long expected
  ) {
    assertThat(TicketReplyToken.parse(token, organizationId, secret)).isEqualTo(
      expected
    );
  }

  @Test
  void theTableHasBothPolaritiesAndPinsTheLenientHexDecode() {
    int accepted = 0;
    boolean lenient = false;
    for (JsonNode row : table().get("token")) {
      if (!row.get(3).isNull()) {
        accepted++;
        String mac = row.get(0).asString().split("-")[1];
        if (mac.length() != 12) lenient = true;
      }
    }

    assertThat(table().get("address").size()).isGreaterThanOrEqualTo(30);
    assertThat(table().get("token").size()).isGreaterThanOrEqualTo(45);
    assertThat(accepted).isBetween(10, table().get("token").size() - 10);
    assertThat(lenient)
      .as("a row where Node accepts a MAC that is not exactly 12 hex digits")
      .isTrue();
  }
}
