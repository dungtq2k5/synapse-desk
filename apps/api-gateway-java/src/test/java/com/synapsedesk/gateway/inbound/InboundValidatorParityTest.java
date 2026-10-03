package com.synapsedesk.gateway.inbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.validation.ParityTable;
import com.synapsedesk.gateway.validation.StrictIso8601;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

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

  static Stream<Arguments> emails() {
    return ParityTable.rows("email");
  }

  static Stream<Arguments> dates() {
    return ParityTable.rows("iso8601");
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
      assertThat(ParityTable.answers(kind))
        .hasSizeGreaterThanOrEqualTo(50)
        .contains(true)
        .contains(false);
    }
  }
}
