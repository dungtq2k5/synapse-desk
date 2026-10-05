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
 * AiClassificationResponseDto
 */

public class AiClassificationResponseDto {

  private String suggestedDepartmentId;

  /**
   * Null when the model named something that is not a priority.  The value crosses two hops: rag-service (Python) answers a bare string, and ticket-service narrows it there — at the one boundary where it is genuinely foreign — before putting it on `ClassifyTicketResponse` as a real enum. So a `MEDIUM-HIGH` or a translated label arrives here as null rather than as a suggestion the UI would render and no agent could apply.
   */
  public enum SuggestedPriorityEnum {
    HIGH("HIGH"),

    LOW("LOW"),

    MEDIUM("MEDIUM"),

    URGENT("URGENT");

    private final String value;

    SuggestedPriorityEnum(String value) {
      this.value = value;
    }

    @JsonValue
    public String getValue() {
      return value;
    }

    @Override
    public String toString() {
      return String.valueOf(value);
    }

    @JsonCreator
    public static SuggestedPriorityEnum fromValue(String value) {
      for (SuggestedPriorityEnum b : SuggestedPriorityEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private SuggestedPriorityEnum suggestedPriority = null;

  private BigDecimal confidenceScore;

  public AiClassificationResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AiClassificationResponseDto(
    String suggestedDepartmentId,
    SuggestedPriorityEnum suggestedPriority,
    BigDecimal confidenceScore
  ) {
    this.suggestedDepartmentId = suggestedDepartmentId;
    this.suggestedPriority = suggestedPriority;
    this.confidenceScore = confidenceScore;
  }

  public AiClassificationResponseDto suggestedDepartmentId(
    String suggestedDepartmentId
  ) {
    this.suggestedDepartmentId = suggestedDepartmentId;
    return this;
  }

  /**
   * Get suggestedDepartmentId
   * @return suggestedDepartmentId
   */
  @NotNull
  @JsonProperty("suggestedDepartmentId")
  public String getSuggestedDepartmentId() {
    return suggestedDepartmentId;
  }

  @JsonProperty("suggestedDepartmentId")
  public void setSuggestedDepartmentId(String suggestedDepartmentId) {
    this.suggestedDepartmentId = suggestedDepartmentId;
  }

  public AiClassificationResponseDto suggestedPriority(
    SuggestedPriorityEnum suggestedPriority
  ) {
    this.suggestedPriority = suggestedPriority;
    return this;
  }

  /**
   * Null when the model named something that is not a priority.  The value crosses two hops: rag-service (Python) answers a bare string, and ticket-service narrows it there — at the one boundary where it is genuinely foreign — before putting it on `ClassifyTicketResponse` as a real enum. So a `MEDIUM-HIGH` or a translated label arrives here as null rather than as a suggestion the UI would render and no agent could apply.
   * @return suggestedPriority
   */

  @JsonProperty("suggestedPriority")
  public SuggestedPriorityEnum getSuggestedPriority() {
    return suggestedPriority;
  }

  @JsonProperty("suggestedPriority")
  public void setSuggestedPriority(SuggestedPriorityEnum suggestedPriority) {
    this.suggestedPriority = suggestedPriority;
  }

  public AiClassificationResponseDto confidenceScore(
    BigDecimal confidenceScore
  ) {
    this.confidenceScore = confidenceScore;
    return this;
  }

  /**
   * Get confidenceScore
   * @return confidenceScore
   */
  @NotNull
  @Valid
  @JsonProperty("confidenceScore")
  public BigDecimal getConfidenceScore() {
    return confidenceScore;
  }

  @JsonProperty("confidenceScore")
  public void setConfidenceScore(BigDecimal confidenceScore) {
    this.confidenceScore = confidenceScore;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AiClassificationResponseDto aiClassificationResponseDto =
      (AiClassificationResponseDto) o;
    return (
      Objects.equals(
        this.suggestedDepartmentId,
        aiClassificationResponseDto.suggestedDepartmentId
      ) &&
      Objects.equals(
        this.suggestedPriority,
        aiClassificationResponseDto.suggestedPriority
      ) &&
      Objects.equals(
        this.confidenceScore,
        aiClassificationResponseDto.confidenceScore
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      suggestedDepartmentId,
      suggestedPriority,
      confidenceScore
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AiClassificationResponseDto {\n");
    sb.append("    suggestedDepartmentId: ")
      .append(toIndentedString(suggestedDepartmentId))
      .append("\n");
    sb.append("    suggestedPriority: ")
      .append(toIndentedString(suggestedPriority))
      .append("\n");
    sb.append("    confidenceScore: ")
      .append(toIndentedString(confidenceScore))
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
