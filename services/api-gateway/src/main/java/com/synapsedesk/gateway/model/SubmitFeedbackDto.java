package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SubmitFeedbackDto
 */

public class SubmitFeedbackDto {

  /**
   * A thumb: `1` for up, `-1` for down.
   */
  public enum RatingEnum {
    NUMBER_MINUS_1(new BigDecimal("-1")),

    NUMBER_1(new BigDecimal("1"));

    private final BigDecimal value;

    RatingEnum(BigDecimal value) {
      this.value = value;
    }

    @JsonValue
    public BigDecimal getValue() {
      return value;
    }

    @Override
    public String toString() {
      return String.valueOf(value);
    }

    @JsonCreator
    public static RatingEnum fromValue(BigDecimal value) {
      for (RatingEnum b : RatingEnum.values()) {
        if (value != null && b.value.compareTo(value) == 0) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private RatingEnum rating;

  private @Nullable String feedbackText;

  private @Nullable Boolean citationAccurate;

  public SubmitFeedbackDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public SubmitFeedbackDto(RatingEnum rating) {
    this.rating = rating;
  }

  public SubmitFeedbackDto rating(RatingEnum rating) {
    this.rating = rating;
    return this;
  }

  /**
   * A thumb: `1` for up, `-1` for down.
   * @return rating
   */
  @NotNull
  @Valid
  @JsonProperty("rating")
  public RatingEnum getRating() {
    return rating;
  }

  @JsonProperty("rating")
  public void setRating(RatingEnum rating) {
    this.rating = rating;
  }

  public SubmitFeedbackDto feedbackText(@Nullable String feedbackText) {
    this.feedbackText = feedbackText;
    return this;
  }

  /**
   * Get feedbackText
   * @return feedbackText
   */
  @Size(min = 1, max = 20000)
  @JsonProperty("feedbackText")
  public @Nullable String getFeedbackText() {
    return feedbackText;
  }

  @JsonProperty("feedbackText")
  public void setFeedbackText(@Nullable String feedbackText) {
    this.feedbackText = feedbackText;
  }

  public SubmitFeedbackDto citationAccurate(
    @Nullable Boolean citationAccurate
  ) {
    this.citationAccurate = citationAccurate;
    return this;
  }

  /**
   * Whether the citations the model gave were accurate.  Tri-state on purpose — absent means \"not assessed\", which is different from \"assessed and wrong\". Collapsing the two would make every un-assessed reply look like a citation failure in the quality report.
   * @return citationAccurate
   */

  @JsonProperty("citationAccurate")
  public @Nullable Boolean getCitationAccurate() {
    return citationAccurate;
  }

  @JsonProperty("citationAccurate")
  public void setCitationAccurate(@Nullable Boolean citationAccurate) {
    this.citationAccurate = citationAccurate;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    SubmitFeedbackDto submitFeedbackDto = (SubmitFeedbackDto) o;
    return (
      Objects.equals(this.rating, submitFeedbackDto.rating) &&
      Objects.equals(this.feedbackText, submitFeedbackDto.feedbackText) &&
      Objects.equals(this.citationAccurate, submitFeedbackDto.citationAccurate)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(rating, feedbackText, citationAccurate);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class SubmitFeedbackDto {\n");
    sb.append("    rating: ").append(toIndentedString(rating)).append("\n");
    sb.append("    feedbackText: ")
      .append(toIndentedString(feedbackText))
      .append("\n");
    sb.append("    citationAccurate: ")
      .append(toIndentedString(citationAccurate))
      .append("\n");
    sb.append("}");
    return sb.toString();
  }

  /**
   * Convert the given object to string with each line indented by 4 spaces
   * (except the first line).
   */
  private String toIndentedString(@Nullable Object o) {
    return o == null ? "null" : o.toString().replace("\n", "\n    ");
  }
}
