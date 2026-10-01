package com.synapsedesk.gateway.inbound;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The Java ports of {@code @IsEmail()} and {@code @IsISO8601({ strict: true })},
 * held to the table the Node gateway recomputes from the real functions on every
 * run ({@code validator-parity.spec.ts}).
 *
 * <p>Neither side can drift alone: change the table and the Node spec goes red
 * unless the library agrees; change a port and this goes red unless the table
 * does. The table is the one fact; this file only reads it.
 */
class InboundValidatorParityTest {

  private static final Path TABLE = Path.of(
    "..",
    "api-gateway",
    "test",
    "fixtures",
    "inbound-email",
    "validator-parity.json"
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

  private static Stream<Arguments> rows(String kind) {
    List<Arguments> rows = new ArrayList<>();
    for (JsonNode row : table().get(kind)) {
      rows.add(Arguments.of(row.get(0).asString(), row.get(1).asBoolean()));
    }

    return rows.stream();
  }

  static Stream<Arguments> emails() {
    return rows("email");
  }

  static Stream<Arguments> dates() {
    return rows("iso8601");
  }

  @ParameterizedTest(name = "isEmail({0}) is {1}")
  @MethodSource("emails")
  void emailAgreesWithClassValidator(String input, boolean expected) {
    assertThat(StrictEmail.Validator.accepts(input)).isEqualTo(expected);
  }

  @ParameterizedTest(name = "isISO8601({0}, strict) is {1}")
  @MethodSource("dates")
  void isoDateAgreesWithClassValidator(String input, boolean expected) {
    assertThat(StrictIso8601.Validator.accepts(input)).isEqualTo(expected);
  }

  @org.junit.jupiter.api.Test
  void theTableHasBothPolaritiesAndEnoughRowsToMeanSomething() {
    // A table of all-true rows, or a handful, would be satisfied by a port that
    // accepts everything.
    for (String kind : List.of("email", "iso8601")) {
      List<Boolean> answers = new ArrayList<>();
      table()
        .get(kind)
        .forEach(row -> answers.add(row.get(1).asBoolean()));

      assertThat(answers)
        .hasSizeGreaterThanOrEqualTo(50)
        .contains(true)
        .contains(false);
    }
  }
}
