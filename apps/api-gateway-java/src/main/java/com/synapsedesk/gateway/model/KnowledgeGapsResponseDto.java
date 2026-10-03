package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.KnowledgeGapFlagResponseDto;
import com.synapsedesk.gateway.model.RateResponseDto;
import com.synapsedesk.gateway.model.UnavailableBlockResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * KnowledgeGapsResponseDto
 */

public class KnowledgeGapsResponseDto {

  private BigDecimal emptyRetrievals;

  private BigDecimal answeringGenerations;

  private RateResponseDto emptyRetrievalRate;

  private RateResponseDto attachmentGroundedRate;

  private BigDecimal attachmentEmptyRetrievals;

  private List<@Valid KnowledgeGapFlagResponseDto> flags = new ArrayList<>();

  private String dataThrough = null;

  private List<@Valid UnavailableBlockResponseDto> unavailable =
    new ArrayList<>();

  public KnowledgeGapsResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public KnowledgeGapsResponseDto(
    BigDecimal emptyRetrievals,
    BigDecimal answeringGenerations,
    RateResponseDto emptyRetrievalRate,
    RateResponseDto attachmentGroundedRate,
    BigDecimal attachmentEmptyRetrievals,
    List<@Valid KnowledgeGapFlagResponseDto> flags,
    String dataThrough,
    List<@Valid UnavailableBlockResponseDto> unavailable
  ) {
    this.emptyRetrievals = emptyRetrievals;
    this.answeringGenerations = answeringGenerations;
    this.emptyRetrievalRate = emptyRetrievalRate;
    this.attachmentGroundedRate = attachmentGroundedRate;
    this.attachmentEmptyRetrievals = attachmentEmptyRetrievals;
    this.flags = flags;
    this.dataThrough = dataThrough;
    this.unavailable = unavailable;
  }

  public KnowledgeGapsResponseDto emptyRetrievals(BigDecimal emptyRetrievals) {
    this.emptyRetrievals = emptyRetrievals;
    return this;
  }

  /**
   * Get emptyRetrievals
   * @return emptyRetrievals
   */
  @NotNull
  @Valid
  @JsonProperty("emptyRetrievals")
  public BigDecimal getEmptyRetrievals() {
    return emptyRetrievals;
  }

  @JsonProperty("emptyRetrievals")
  public void setEmptyRetrievals(BigDecimal emptyRetrievals) {
    this.emptyRetrievals = emptyRetrievals;
  }

  public KnowledgeGapsResponseDto answeringGenerations(
    BigDecimal answeringGenerations
  ) {
    this.answeringGenerations = answeringGenerations;
    return this;
  }

  /**
   * Get answeringGenerations
   * @return answeringGenerations
   */
  @NotNull
  @Valid
  @JsonProperty("answeringGenerations")
  public BigDecimal getAnsweringGenerations() {
    return answeringGenerations;
  }

  @JsonProperty("answeringGenerations")
  public void setAnsweringGenerations(BigDecimal answeringGenerations) {
    this.answeringGenerations = answeringGenerations;
  }

  public KnowledgeGapsResponseDto emptyRetrievalRate(
    RateResponseDto emptyRetrievalRate
  ) {
    this.emptyRetrievalRate = emptyRetrievalRate;
    return this;
  }

  /**
   * Over ATTACHMENT-FREE answering generations only.  `emptyRetrievals` above stays the total, so the two read together: a question about a user's own file retrieved nothing correctly, and is not a gap in the corpus.
   * @return emptyRetrievalRate
   */
  @NotNull
  @Valid
  @JsonProperty("emptyRetrievalRate")
  public RateResponseDto getEmptyRetrievalRate() {
    return emptyRetrievalRate;
  }

  @JsonProperty("emptyRetrievalRate")
  public void setEmptyRetrievalRate(RateResponseDto emptyRetrievalRate) {
    this.emptyRetrievalRate = emptyRetrievalRate;
  }

  public KnowledgeGapsResponseDto attachmentGroundedRate(
    RateResponseDto attachmentGroundedRate
  ) {
    this.attachmentGroundedRate = attachmentGroundedRate;
    return this;
  }

  /**
   * How many answering generations were given a file — reported, not hidden.
   * @return attachmentGroundedRate
   */
  @NotNull
  @Valid
  @JsonProperty("attachmentGroundedRate")
  public RateResponseDto getAttachmentGroundedRate() {
    return attachmentGroundedRate;
  }

  @JsonProperty("attachmentGroundedRate")
  public void setAttachmentGroundedRate(
    RateResponseDto attachmentGroundedRate
  ) {
    this.attachmentGroundedRate = attachmentGroundedRate;
  }

  public KnowledgeGapsResponseDto attachmentEmptyRetrievals(
    BigDecimal attachmentEmptyRetrievals
  ) {
    this.attachmentEmptyRetrievals = attachmentEmptyRetrievals;
    return this;
  }

  /**
   * The part of `emptyRetrievals` the rate above excludes.
   * @return attachmentEmptyRetrievals
   */
  @NotNull
  @Valid
  @JsonProperty("attachmentEmptyRetrievals")
  public BigDecimal getAttachmentEmptyRetrievals() {
    return attachmentEmptyRetrievals;
  }

  @JsonProperty("attachmentEmptyRetrievals")
  public void setAttachmentEmptyRetrievals(
    BigDecimal attachmentEmptyRetrievals
  ) {
    this.attachmentEmptyRetrievals = attachmentEmptyRetrievals;
  }

  public KnowledgeGapsResponseDto flags(
    List<@Valid KnowledgeGapFlagResponseDto> flags
  ) {
    this.flags = flags;
    return this;
  }

  public KnowledgeGapsResponseDto addFlagsItem(
    KnowledgeGapFlagResponseDto flagsItem
  ) {
    if (this.flags == null) {
      this.flags = new ArrayList<>();
    }
    this.flags.add(flagsItem);
    return this;
  }

  /**
   * Get flags
   * @return flags
   */
  @NotNull
  @Valid
  @JsonProperty("flags")
  public List<@Valid KnowledgeGapFlagResponseDto> getFlags() {
    return flags;
  }

  @JsonProperty("flags")
  public void setFlags(List<@Valid KnowledgeGapFlagResponseDto> flags) {
    this.flags = flags;
  }

  public KnowledgeGapsResponseDto dataThrough(String dataThrough) {
    this.dataThrough = dataThrough;
    return this;
  }

  /**
   * See `AgentAnalyticsResponseDto.dataThrough`.
   * @return dataThrough
   */

  @JsonProperty("dataThrough")
  public String getDataThrough() {
    return dataThrough;
  }

  @JsonProperty("dataThrough")
  public void setDataThrough(String dataThrough) {
    this.dataThrough = dataThrough;
  }

  public KnowledgeGapsResponseDto unavailable(
    List<@Valid UnavailableBlockResponseDto> unavailable
  ) {
    this.unavailable = unavailable;
    return this;
  }

  public KnowledgeGapsResponseDto addUnavailableItem(
    UnavailableBlockResponseDto unavailableItem
  ) {
    if (this.unavailable == null) {
      this.unavailable = new ArrayList<>();
    }
    this.unavailable.add(unavailableItem);
    return this;
  }

  /**
   * Get unavailable
   * @return unavailable
   */
  @NotNull
  @Valid
  @JsonProperty("unavailable")
  public List<@Valid UnavailableBlockResponseDto> getUnavailable() {
    return unavailable;
  }

  @JsonProperty("unavailable")
  public void setUnavailable(
    List<@Valid UnavailableBlockResponseDto> unavailable
  ) {
    this.unavailable = unavailable;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    KnowledgeGapsResponseDto knowledgeGapsResponseDto =
      (KnowledgeGapsResponseDto) o;
    return (
      Objects.equals(
        this.emptyRetrievals,
        knowledgeGapsResponseDto.emptyRetrievals
      ) &&
      Objects.equals(
        this.answeringGenerations,
        knowledgeGapsResponseDto.answeringGenerations
      ) &&
      Objects.equals(
        this.emptyRetrievalRate,
        knowledgeGapsResponseDto.emptyRetrievalRate
      ) &&
      Objects.equals(
        this.attachmentGroundedRate,
        knowledgeGapsResponseDto.attachmentGroundedRate
      ) &&
      Objects.equals(
        this.attachmentEmptyRetrievals,
        knowledgeGapsResponseDto.attachmentEmptyRetrievals
      ) &&
      Objects.equals(this.flags, knowledgeGapsResponseDto.flags) &&
      Objects.equals(this.dataThrough, knowledgeGapsResponseDto.dataThrough) &&
      Objects.equals(this.unavailable, knowledgeGapsResponseDto.unavailable)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      emptyRetrievals,
      answeringGenerations,
      emptyRetrievalRate,
      attachmentGroundedRate,
      attachmentEmptyRetrievals,
      flags,
      dataThrough,
      unavailable
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class KnowledgeGapsResponseDto {\n");
    sb.append("    emptyRetrievals: ")
      .append(toIndentedString(emptyRetrievals))
      .append("\n");
    sb.append("    answeringGenerations: ")
      .append(toIndentedString(answeringGenerations))
      .append("\n");
    sb.append("    emptyRetrievalRate: ")
      .append(toIndentedString(emptyRetrievalRate))
      .append("\n");
    sb.append("    attachmentGroundedRate: ")
      .append(toIndentedString(attachmentGroundedRate))
      .append("\n");
    sb.append("    attachmentEmptyRetrievals: ")
      .append(toIndentedString(attachmentEmptyRetrievals))
      .append("\n");
    sb.append("    flags: ").append(toIndentedString(flags)).append("\n");
    sb.append("    dataThrough: ")
      .append(toIndentedString(dataThrough))
      .append("\n");
    sb.append("    unavailable: ")
      .append(toIndentedString(unavailable))
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
