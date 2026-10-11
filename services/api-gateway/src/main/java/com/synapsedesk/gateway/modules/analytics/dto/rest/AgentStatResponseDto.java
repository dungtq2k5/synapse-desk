package com.synapsedesk.gateway.modules.analytics.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.modules.analytics.dto.rest.MeanResponseDto;
import com.synapsedesk.gateway.modules.analytics.dto.rest.RateResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * AgentStatResponseDto
 */

public class AgentStatResponseDto {

  private String agentId;

  private String fullName = null;

  private BigDecimal assigned;

  private BigDecimal resolved;

  private BigDecimal messagesSent;

  private MeanResponseDto resolutionSeconds;

  private RateResponseDto draftAcceptance = null;

  public AgentStatResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AgentStatResponseDto(
    String agentId,
    String fullName,
    BigDecimal assigned,
    BigDecimal resolved,
    BigDecimal messagesSent,
    MeanResponseDto resolutionSeconds,
    RateResponseDto draftAcceptance
  ) {
    this.agentId = agentId;
    this.fullName = fullName;
    this.assigned = assigned;
    this.resolved = resolved;
    this.messagesSent = messagesSent;
    this.resolutionSeconds = resolutionSeconds;
    this.draftAcceptance = draftAcceptance;
  }

  public AgentStatResponseDto agentId(String agentId) {
    this.agentId = agentId;
    return this;
  }

  /**
   * Get agentId
   * @return agentId
   */
  @NotNull
  @JsonProperty("agentId")
  public String getAgentId() {
    return agentId;
  }

  @JsonProperty("agentId")
  public void setAgentId(String agentId) {
    this.agentId = agentId;
  }

  public AgentStatResponseDto fullName(String fullName) {
    this.fullName = fullName;
    return this;
  }

  /**
   * null when the id could not be resolved — a deleted user, or a lookup that failed.
   * @return fullName
   */

  @JsonProperty("fullName")
  public String getFullName() {
    return fullName;
  }

  @JsonProperty("fullName")
  public void setFullName(String fullName) {
    this.fullName = fullName;
  }

  public AgentStatResponseDto assigned(BigDecimal assigned) {
    this.assigned = assigned;
    return this;
  }

  /**
   * Get assigned
   * @return assigned
   */
  @NotNull
  @Valid
  @JsonProperty("assigned")
  public BigDecimal getAssigned() {
    return assigned;
  }

  @JsonProperty("assigned")
  public void setAssigned(BigDecimal assigned) {
    this.assigned = assigned;
  }

  public AgentStatResponseDto resolved(BigDecimal resolved) {
    this.resolved = resolved;
    return this;
  }

  /**
   * Get resolved
   * @return resolved
   */
  @NotNull
  @Valid
  @JsonProperty("resolved")
  public BigDecimal getResolved() {
    return resolved;
  }

  @JsonProperty("resolved")
  public void setResolved(BigDecimal resolved) {
    this.resolved = resolved;
  }

  public AgentStatResponseDto messagesSent(BigDecimal messagesSent) {
    this.messagesSent = messagesSent;
    return this;
  }

  /**
   * Get messagesSent
   * @return messagesSent
   */
  @NotNull
  @Valid
  @JsonProperty("messagesSent")
  public BigDecimal getMessagesSent() {
    return messagesSent;
  }

  @JsonProperty("messagesSent")
  public void setMessagesSent(BigDecimal messagesSent) {
    this.messagesSent = messagesSent;
  }

  public AgentStatResponseDto resolutionSeconds(
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

  public AgentStatResponseDto draftAcceptance(RateResponseDto draftAcceptance) {
    this.draftAcceptance = draftAcceptance;
    return this;
  }

  /**
   * From the AI ledger. null when that leg was unavailable.
   * @return draftAcceptance
   */
  @Valid
  @JsonProperty("draftAcceptance")
  public RateResponseDto getDraftAcceptance() {
    return draftAcceptance;
  }

  @JsonProperty("draftAcceptance")
  public void setDraftAcceptance(RateResponseDto draftAcceptance) {
    this.draftAcceptance = draftAcceptance;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AgentStatResponseDto agentStatResponseDto = (AgentStatResponseDto) o;
    return (
      Objects.equals(this.agentId, agentStatResponseDto.agentId) &&
      Objects.equals(this.fullName, agentStatResponseDto.fullName) &&
      Objects.equals(this.assigned, agentStatResponseDto.assigned) &&
      Objects.equals(this.resolved, agentStatResponseDto.resolved) &&
      Objects.equals(this.messagesSent, agentStatResponseDto.messagesSent) &&
      Objects.equals(
        this.resolutionSeconds,
        agentStatResponseDto.resolutionSeconds
      ) &&
      Objects.equals(this.draftAcceptance, agentStatResponseDto.draftAcceptance)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      agentId,
      fullName,
      assigned,
      resolved,
      messagesSent,
      resolutionSeconds,
      draftAcceptance
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AgentStatResponseDto {\n");
    sb.append("    agentId: ").append(toIndentedString(agentId)).append("\n");
    sb.append("    fullName: ").append(toIndentedString(fullName)).append("\n");
    sb.append("    assigned: ").append(toIndentedString(assigned)).append("\n");
    sb.append("    resolved: ").append(toIndentedString(resolved)).append("\n");
    sb.append("    messagesSent: ")
      .append(toIndentedString(messagesSent))
      .append("\n");
    sb.append("    resolutionSeconds: ")
      .append(toIndentedString(resolutionSeconds))
      .append("\n");
    sb.append("    draftAcceptance: ")
      .append(toIndentedString(draftAcceptance))
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
