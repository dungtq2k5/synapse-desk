package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.MeanResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * ResponseTimePointResponseDto
 */

public class ResponseTimePointResponseDto {

  private String day;

  private MeanResponseDto humanFirstResponseSeconds;

  private MeanResponseDto aiFirstResponseSeconds;

  private MeanResponseDto resolutionSeconds;

  public ResponseTimePointResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ResponseTimePointResponseDto(
    String day,
    MeanResponseDto humanFirstResponseSeconds,
    MeanResponseDto aiFirstResponseSeconds,
    MeanResponseDto resolutionSeconds
  ) {
    this.day = day;
    this.humanFirstResponseSeconds = humanFirstResponseSeconds;
    this.aiFirstResponseSeconds = aiFirstResponseSeconds;
    this.resolutionSeconds = resolutionSeconds;
  }

  public ResponseTimePointResponseDto day(String day) {
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

  public ResponseTimePointResponseDto humanFirstResponseSeconds(
    MeanResponseDto humanFirstResponseSeconds
  ) {
    this.humanFirstResponseSeconds = humanFirstResponseSeconds;
    return this;
  }

  /**
   * Get humanFirstResponseSeconds
   * @return humanFirstResponseSeconds
   */
  @NotNull
  @Valid
  @JsonProperty("humanFirstResponseSeconds")
  public MeanResponseDto getHumanFirstResponseSeconds() {
    return humanFirstResponseSeconds;
  }

  @JsonProperty("humanFirstResponseSeconds")
  public void setHumanFirstResponseSeconds(
    MeanResponseDto humanFirstResponseSeconds
  ) {
    this.humanFirstResponseSeconds = humanFirstResponseSeconds;
  }

  public ResponseTimePointResponseDto aiFirstResponseSeconds(
    MeanResponseDto aiFirstResponseSeconds
  ) {
    this.aiFirstResponseSeconds = aiFirstResponseSeconds;
    return this;
  }

  /**
   * Get aiFirstResponseSeconds
   * @return aiFirstResponseSeconds
   */
  @NotNull
  @Valid
  @JsonProperty("aiFirstResponseSeconds")
  public MeanResponseDto getAiFirstResponseSeconds() {
    return aiFirstResponseSeconds;
  }

  @JsonProperty("aiFirstResponseSeconds")
  public void setAiFirstResponseSeconds(
    MeanResponseDto aiFirstResponseSeconds
  ) {
    this.aiFirstResponseSeconds = aiFirstResponseSeconds;
  }

  public ResponseTimePointResponseDto resolutionSeconds(
    MeanResponseDto resolutionSeconds
  ) {
    this.resolutionSeconds = resolutionSeconds;
    return this;
  }

  /**
   * Get resolutionSeconds
   * @return resolutionSeconds
   */
  @NotNull
  @Valid
  @JsonProperty("resolutionSeconds")
  public MeanResponseDto getResolutionSeconds() {
    return resolutionSeconds;
  }

  @JsonProperty("resolutionSeconds")
  public void setResolutionSeconds(MeanResponseDto resolutionSeconds) {
    this.resolutionSeconds = resolutionSeconds;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    ResponseTimePointResponseDto responseTimePointResponseDto =
      (ResponseTimePointResponseDto) o;
    return (
      Objects.equals(this.day, responseTimePointResponseDto.day) &&
      Objects.equals(
        this.humanFirstResponseSeconds,
        responseTimePointResponseDto.humanFirstResponseSeconds
      ) &&
      Objects.equals(
        this.aiFirstResponseSeconds,
        responseTimePointResponseDto.aiFirstResponseSeconds
      ) &&
      Objects.equals(
        this.resolutionSeconds,
        responseTimePointResponseDto.resolutionSeconds
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      day,
      humanFirstResponseSeconds,
      aiFirstResponseSeconds,
      resolutionSeconds
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ResponseTimePointResponseDto {\n");
    sb.append("    day: ").append(toIndentedString(day)).append("\n");
    sb.append("    humanFirstResponseSeconds: ")
      .append(toIndentedString(humanFirstResponseSeconds))
      .append("\n");
    sb.append("    aiFirstResponseSeconds: ")
      .append(toIndentedString(aiFirstResponseSeconds))
      .append("\n");
    sb.append("    resolutionSeconds: ")
      .append(toIndentedString(resolutionSeconds))
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
