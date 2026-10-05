package com.synapsedesk.gateway.validation;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * The Java ports of {@code @IsStrongPassword()}, {@code @IsPhoneNumber()},
 * {@code @IsNumberString()} and the lock date's pair ({@code @IsISO8601({ strict: true })}
 * with {@code @IsFutureDate()}), held to the table Node recomputes from the real
 * functions on every run. A table row is the contract; a port that disagrees with one
 * is wrong, not the row.
 */
class FieldValidatorParityTest {

  static Stream<Arguments> passwords() {
    return ParityTable.rows("strongPassword");
  }

  static Stream<Arguments> phones() {
    return ParityTable.rows("phone");
  }

  static Stream<Arguments> numbers() {
    return ParityTable.rows("numeric");
  }

  static Stream<Arguments> lockDates() {
    return ParityTable.rows("lockDate");
  }

  @ParameterizedTest(name = "isStrongPassword({0}) is {1}")
  @MethodSource("passwords")
  void passwordAgreesWithClassValidator(String input, boolean expected) {
    assertThat(StrongPassword.Validator.accepts(input)).isEqualTo(expected);
  }

  @ParameterizedTest(name = "isPhoneNumber({0}) is {1}")
  @MethodSource("phones")
  void phoneAgreesWithClassValidator(String input, boolean expected) {
    assertThat(ValidPhoneNumber.Validator.accepts(input)).isEqualTo(expected);
  }

  @ParameterizedTest(name = "isNumberString({0}) is {1}")
  @MethodSource("numbers")
  void numberStringAgreesWithClassValidator(String input, boolean expected) {
    assertThat(NumberString.Validator.accepts(input)).isEqualTo(expected);
  }

  @ParameterizedTest(name = "a lock date {0} is {1}")
  @MethodSource("lockDates")
  void lockDateAgreesWithTheTwoDecoratorsOnTheField(
    String input,
    boolean expected
  ) {
    assertThat(
      StrictIso8601.Validator.accepts(input) &&
        FutureDate.Validator.accepts(input)
    ).isEqualTo(expected);
  }

  @Test
  void theTablesHaveBothPolaritiesAndEnoughRowsToMeanSomething() {
    for (String kind : List.of("strongPassword", "phone", "lockDate")) {
      assertThat(ParityTable.answers(kind))
        .hasSizeGreaterThanOrEqualTo(40)
        .contains(true)
        .contains(false);
    }
    assertThat(ParityTable.answers("numeric"))
      .hasSizeGreaterThanOrEqualTo(20)
      .contains(true)
      .contains(false);
  }
}
