package com.synapsedesk.gateway.validation;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.params.provider.Arguments;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The shared validator table the Node gateway recomputes from the real functions on
 * every run ({@code validator-parity.spec.ts}); the Java ports are held to it row for
 * row. The table is the one fact, and this only reads it.
 */
public final class ParityTable {

  private static final Path TABLE = Path.of(
    "..",
    "api-gateway",
    "test",
    "fixtures",
    "inbound-email",
    "validator-parity.json"
  );

  private ParityTable() {}

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

  /** The rows of one kind as (input, expected answer). */
  public static Stream<Arguments> rows(String kind) {
    List<Arguments> rows = new ArrayList<>();
    for (JsonNode row : table().get(kind)) {
      rows.add(Arguments.of(row.get(0).asString(), row.get(1).asBoolean()));
    }

    return rows.stream();
  }

  /** What a kind's rows answer, for checking that both polarities are present. */
  public static List<Boolean> answers(String kind) {
    List<Boolean> answers = new ArrayList<>();
    table()
      .get(kind)
      .forEach(row -> answers.add(row.get(1).asBoolean()));

    return answers;
  }
}
