package com.synapsedesk.gateway.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.synapsedesk.gateway.model.SubmitFeedbackDto.RatingEnum;
import java.math.BigDecimal;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * A rating is compared as a number: JSON's `1.0` is the thumb `1`, whatever
 * scale Jackson gives the {@link BigDecimal}.
 */
class RatingEnumTest {

  @ParameterizedTest
  @ValueSource(strings = { "1", "1.0", "1.00" })
  void anUpThumbInAnyScaleIsOne(String rating) {
    assertThat(RatingEnum.fromValue(new BigDecimal(rating))).isEqualTo(
      RatingEnum.NUMBER_1
    );
  }

  @ParameterizedTest
  @ValueSource(strings = { "-1", "-1.0" })
  void aDownThumbInAnyScaleIsMinusOne(String rating) {
    assertThat(RatingEnum.fromValue(new BigDecimal(rating))).isEqualTo(
      RatingEnum.NUMBER_MINUS_1
    );
  }

  @ParameterizedTest
  @ValueSource(strings = { "0", "1.5" })
  void anyOtherNumberIsRefused(String rating) {
    assertThatThrownBy(() ->
      RatingEnum.fromValue(new BigDecimal(rating))
    ).isInstanceOf(IllegalArgumentException.class);
  }

  @ParameterizedTest
  @NullSource
  void noRatingIsRefused(BigDecimal rating) {
    assertThatThrownBy(() -> RatingEnum.fromValue(rating)).isInstanceOf(
      IllegalArgumentException.class
    );
  }
}
