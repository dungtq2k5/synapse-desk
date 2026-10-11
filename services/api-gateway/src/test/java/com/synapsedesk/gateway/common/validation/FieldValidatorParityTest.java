package com.synapsedesk.gateway.common.validation;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * The validators for {@code @IsStrongPassword()}, {@code @IsPhoneNumber()} and
 * {@code @IsNumberString()}, held to the committed table generated from the real
 * class-validator functions. A table row is the contract; a validator that disagrees
 * with one is wrong, not the row.
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

  @Test
  void theTablesHaveBothPolaritiesAndEnoughRowsToMeanSomething() {
    for (String kind : List.of("strongPassword", "phone")) {
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
