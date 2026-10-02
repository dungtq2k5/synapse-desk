package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * AiUsagePointResponseDto
 */

public class AiUsagePointResponseDto {

  private String day;

  private BigDecimal generations;

  private BigDecimal costMicros;

  public AiUsagePointResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AiUsagePointResponseDto(
    String day,
    BigDecimal generations,
    BigDecimal costMicros
  ) {
    this.day = day;
    this.generations = generations;
    this.costMicros = costMicros;
  }

  public AiUsagePointResponseDto day(String day) {
    this.day = day;
    return this;
  }

  /**
   * Get day
   * @return day
   */
  @NotNull
  @JsonProperty("day")
  public String getDay() {
    return day;
  }

  @JsonProperty("day")
  public void setDay(String day) {
    this.day = day;
  }

  public AiUsagePointResponseDto generations(BigDecimal generations) {
    this.generations = generations;
    return this;
  }

  /**
   * Get generations
   * @return generations
   */
  @NotNull
  @Valid
  @JsonProperty("generations")
  public BigDecimal getGenerations() {
    return generations;
  }

  @JsonProperty("generations")
  public void setGenerations(BigDecimal generations) {
    this.generations = generations;
  }

  public AiUsagePointResponseDto costMicros(BigDecimal costMicros) {
    this.costMicros = costMicros;
    return this;
  }

  /**
   * Get costMicros
   * @return costMicros
   */
  @NotNull
  @Valid
  @JsonProperty("costMicros")
  public BigDecimal getCostMicros() {
    return costMicros;
  }

  @JsonProperty("costMicros")
  public void setCostMicros(BigDecimal costMicros) {
    this.costMicros = costMicros;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AiUsagePointResponseDto aiUsagePointResponseDto =
      (AiUsagePointResponseDto) o;
    return (
      Objects.equals(this.day, aiUsagePointResponseDto.day) &&
      Objects.equals(this.generations, aiUsagePointResponseDto.generations) &&
      Objects.equals(this.costMicros, aiUsagePointResponseDto.costMicros)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(day, generations, costMicros);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AiUsagePointResponseDto {\n");
    sb.append("    day: ").append(toIndentedString(day)).append("\n");
    sb.append("    generations: ")
      .append(toIndentedString(generations))
      .append("\n");
    sb.append("    costMicros: ")
      .append(toIndentedString(costMicros))
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
