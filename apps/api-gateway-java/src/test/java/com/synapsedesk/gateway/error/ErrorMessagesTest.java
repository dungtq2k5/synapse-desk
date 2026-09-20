package com.synapsedesk.gateway.error;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * The trailing `!` rule, which is the Node side's `formatErrorMsg`.
 *
 * <p>This text is OURS, so these rows are byte-equal contracts rather than
 * loose matches — the distinction plan 81 section 3 draws.
 */
class ErrorMessagesTest {

  @ParameterizedTest(name = "{0} -> {1}")
  @CsvSource({
    "'Unauthorized','Unauthorized!'",
    "'Unauthorized!','Unauthorized!'",
    "'Nope.','Nope!'",
    "'Really?','Really!'",
    "'Nope...','Nope!'",
    "'Mixed.?!','Mixed!'",
    "'','!'",
  })
  void trimsEveryTrailingStopAndAddsExactlyOne(String input, String expected) {
    // GREEDY on purpose: `formatErrorMsg` strips every trailing `.`/`!`/`?`
    // before adding one. A single-character trim leaves `Nope..`.
    assertThat(ErrorMessages.format(input)).isEqualTo(expected);
  }

  @Test
  void joinsConstraintMessagesTheWayTheNodeSideJoinsThem() {
    // The capture: "email must be an email, password must be a string,
    // password should not be empty!" — `, ` between, one `!` at the end.
    assertThat(
            ErrorMessages.format(
                List.of(
                    "email must be an email",
                    "password must be a string",
                    "password should not be empty")))
        .isEqualTo("email must be an email, password must be a string, password should not be empty!");
  }

  @Test
  void aSingleMessageIsNotDecoratedWithASeparator() {
    assertThat(ErrorMessages.format(List.of("email must be an email")))
        .isEqualTo("email must be an email!");
  }
}
