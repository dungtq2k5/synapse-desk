package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.RateResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.springframework.lang.Nullable;

/**
 * DeflectionPointResponseDto
 */

public class DeflectionPointResponseDto {

  private String day;

  private RateResponseDto deflection;

  private BigDecimal chatConversations;

  private BigDecimal chatResolvedWithoutEscalation;

  public DeflectionPointResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DeflectionPointResponseDto(
    String day,
    RateResponseDto deflection,
    BigDecimal chatConversations,
    BigDecimal chatResolvedWithoutEscalation
  ) {
    this.day = day;
    this.deflection = deflection;
    this.chatConversations = chatConversations;
    this.chatResolvedWithoutEscalation = chatResolvedWithoutEscalation;
  }

  public DeflectionPointResponseDto day(String day) {
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

  public DeflectionPointResponseDto deflection(RateResponseDto deflection) {
    this.deflection = deflection;
    return this;
  }

  /**
   * Get deflection
   * @return deflection
   */
  @NotNull
  @Valid
  @JsonProperty("deflection")
  public RateResponseDto getDeflection() {
    return deflection;
  }

  @JsonProperty("deflection")
  public void setDeflection(RateResponseDto deflection) {
    this.deflection = deflection;
  }

  public DeflectionPointResponseDto chatConversations(
    BigDecimal chatConversations
  ) {
    this.chatConversations = chatConversations;
    return this;
  }

  /**
   * Get chatConversations
   * @return chatConversations
   */
  @NotNull
  @Valid
  @JsonProperty("chatConversations")
  public BigDecimal getChatConversations() {
    return chatConversations;
  }

  @JsonProperty("chatConversations")
  public void setChatConversations(BigDecimal chatConversations) {
    this.chatConversations = chatConversations;
  }

  public DeflectionPointResponseDto chatResolvedWithoutEscalation(
    BigDecimal chatResolvedWithoutEscalation
  ) {
    this.chatResolvedWithoutEscalation = chatResolvedWithoutEscalation;
    return this;
  }

  /**
   * Get chatResolvedWithoutEscalation
   * @return chatResolvedWithoutEscalation
   */
  @NotNull
  @Valid
  @JsonProperty("chatResolvedWithoutEscalation")
  public BigDecimal getChatResolvedWithoutEscalation() {
    return chatResolvedWithoutEscalation;
  }

  @JsonProperty("chatResolvedWithoutEscalation")
  public void setChatResolvedWithoutEscalation(
    BigDecimal chatResolvedWithoutEscalation
  ) {
    this.chatResolvedWithoutEscalation = chatResolvedWithoutEscalation;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DeflectionPointResponseDto deflectionPointResponseDto =
      (DeflectionPointResponseDto) o;
    return (
      Objects.equals(this.day, deflectionPointResponseDto.day) &&
      Objects.equals(this.deflection, deflectionPointResponseDto.deflection) &&
      Objects.equals(
        this.chatConversations,
        deflectionPointResponseDto.chatConversations
      ) &&
      Objects.equals(
        this.chatResolvedWithoutEscalation,
        deflectionPointResponseDto.chatResolvedWithoutEscalation
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      day,
      deflection,
      chatConversations,
      chatResolvedWithoutEscalation
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DeflectionPointResponseDto {\n");
    sb.append("    day: ").append(toIndentedString(day)).append("\n");
    sb.append("    deflection: ")
      .append(toIndentedString(deflection))
      .append("\n");
    sb.append("    chatConversations: ")
      .append(toIndentedString(chatConversations))
      .append("\n");
    sb.append("    chatResolvedWithoutEscalation: ")
      .append(toIndentedString(chatResolvedWithoutEscalation))
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
