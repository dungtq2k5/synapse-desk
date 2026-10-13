package com.synapsedesk.gateway.modules.analytics.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * OverviewResponseDto
 */

public class OverviewResponseDto {

  private BigDecimal ticketsCreated;

  private BigDecimal ticketsResolved;

  private BigDecimal ticketsEscalated;

  private BigDecimal openTickets;

  private RateResponseDto deflection;

  private RateResponseDto csat;

  private MeanResponseDto humanFirstResponseSeconds;

  private MeanResponseDto aiFirstResponseSeconds;

  private MeanResponseDto resolutionSeconds;

  private BigDecimal openTicketMedianAgeSeconds = null;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime computedAt = null;

  private String dataThrough = null;

  public OverviewResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public OverviewResponseDto(
    BigDecimal ticketsCreated,
    BigDecimal ticketsResolved,
    BigDecimal ticketsEscalated,
    BigDecimal openTickets,
    RateResponseDto deflection,
    RateResponseDto csat,
    MeanResponseDto humanFirstResponseSeconds,
    MeanResponseDto aiFirstResponseSeconds,
    MeanResponseDto resolutionSeconds,
    BigDecimal openTicketMedianAgeSeconds,
    OffsetDateTime computedAt,
    String dataThrough
  ) {
    this.ticketsCreated = ticketsCreated;
    this.ticketsResolved = ticketsResolved;
    this.ticketsEscalated = ticketsEscalated;
    this.openTickets = openTickets;
    this.deflection = deflection;
    this.csat = csat;
    this.humanFirstResponseSeconds = humanFirstResponseSeconds;
    this.aiFirstResponseSeconds = aiFirstResponseSeconds;
    this.resolutionSeconds = resolutionSeconds;
    this.openTicketMedianAgeSeconds = openTicketMedianAgeSeconds;
    this.computedAt = computedAt;
    this.dataThrough = dataThrough;
  }

  public OverviewResponseDto ticketsCreated(BigDecimal ticketsCreated) {
    this.ticketsCreated = ticketsCreated;
    return this;
  }

  /**
   * Get ticketsCreated
   * @return ticketsCreated
   */
  @NotNull
  @Valid
  @JsonProperty("ticketsCreated")
  public BigDecimal getTicketsCreated() {
    return ticketsCreated;
  }

  @JsonProperty("ticketsCreated")
  public void setTicketsCreated(BigDecimal ticketsCreated) {
    this.ticketsCreated = ticketsCreated;
  }

  public OverviewResponseDto ticketsResolved(BigDecimal ticketsResolved) {
    this.ticketsResolved = ticketsResolved;
    return this;
  }

  /**
   * Get ticketsResolved
   * @return ticketsResolved
   */
  @NotNull
  @Valid
  @JsonProperty("ticketsResolved")
  public BigDecimal getTicketsResolved() {
    return ticketsResolved;
  }

  @JsonProperty("ticketsResolved")
  public void setTicketsResolved(BigDecimal ticketsResolved) {
    this.ticketsResolved = ticketsResolved;
  }

  public OverviewResponseDto ticketsEscalated(BigDecimal ticketsEscalated) {
    this.ticketsEscalated = ticketsEscalated;
    return this;
  }

  /**
   * Get ticketsEscalated
   * @return ticketsEscalated
   */
  @NotNull
  @Valid
  @JsonProperty("ticketsEscalated")
  public BigDecimal getTicketsEscalated() {
    return ticketsEscalated;
  }

  @JsonProperty("ticketsEscalated")
  public void setTicketsEscalated(BigDecimal ticketsEscalated) {
    this.ticketsEscalated = ticketsEscalated;
  }

  public OverviewResponseDto openTickets(BigDecimal openTickets) {
    this.openTickets = openTickets;
    return this;
  }

  /**
   * Get openTickets
   * @return openTickets
   */
  @NotNull
  @Valid
  @JsonProperty("openTickets")
  public BigDecimal getOpenTickets() {
    return openTickets;
  }

  @JsonProperty("openTickets")
  public void setOpenTickets(BigDecimal openTickets) {
    this.openTickets = openTickets;
  }

  public OverviewResponseDto deflection(RateResponseDto deflection) {
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

  public OverviewResponseDto csat(RateResponseDto csat) {
    this.csat = csat;
    return this;
  }

  /**
   * Get csat
   * @return csat
   */
  @NotNull
  @Valid
  @JsonProperty("csat")
  public RateResponseDto getCsat() {
    return csat;
  }

  @JsonProperty("csat")
  public void setCsat(RateResponseDto csat) {
    this.csat = csat;
  }

  public OverviewResponseDto humanFirstResponseSeconds(
    MeanResponseDto humanFirstResponseSeconds
  ) {
    this.humanFirstResponseSeconds = humanFirstResponseSeconds;
    return this;
  }

  /**
   * Reported apart from the AI figure, always.
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

  public OverviewResponseDto aiFirstResponseSeconds(
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

  public OverviewResponseDto resolutionSeconds(
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

  public OverviewResponseDto openTicketMedianAgeSeconds(
    BigDecimal openTicketMedianAgeSeconds
  ) {
    this.openTicketMedianAgeSeconds = openTicketMedianAgeSeconds;
    return this;
  }

  /**
   * The counterweight to `resolutionSeconds`, which can only see tickets that closed and is therefore biased optimistic.
   * @return openTicketMedianAgeSeconds
   */
  @Valid
  @JsonProperty("openTicketMedianAgeSeconds")
  public BigDecimal getOpenTicketMedianAgeSeconds() {
    return openTicketMedianAgeSeconds;
  }

  @JsonProperty("openTicketMedianAgeSeconds")
  public void setOpenTicketMedianAgeSeconds(
    BigDecimal openTicketMedianAgeSeconds
  ) {
    this.openTicketMedianAgeSeconds = openTicketMedianAgeSeconds;
  }

  public OverviewResponseDto computedAt(OffsetDateTime computedAt) {
    this.computedAt = computedAt;
    return this;
  }

  /**
   * When the rollups behind this answer ran.
   * @return computedAt
   */
  @Valid
  @JsonProperty("computedAt")
  public OffsetDateTime getComputedAt() {
    return computedAt;
  }

  @JsonProperty("computedAt")
  public void setComputedAt(OffsetDateTime computedAt) {
    this.computedAt = computedAt;
  }

  public OverviewResponseDto dataThrough(String dataThrough) {
    this.dataThrough = dataThrough;
    return this;
  }

  /**
   * **The last day the rollups behind this answer cover**, `YYYY-MM-DD`, or `null` when no rollup has ever run for this tenant.  Not the same as `computedAt`, and the gap between them is the diagnosis: a recent `computedAt` beside a `dataThrough` two weeks old means the job runs and finds nothing, while `dataThrough: null` means it has never run at all. A dashboard of zeros looks identical in both cases without this field — which is how seven scheduled jobs sat uncalled and nothing complained.
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

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    OverviewResponseDto overviewResponseDto = (OverviewResponseDto) o;
    return (
      Objects.equals(this.ticketsCreated, overviewResponseDto.ticketsCreated) &&
      Objects.equals(
        this.ticketsResolved,
        overviewResponseDto.ticketsResolved
      ) &&
      Objects.equals(
        this.ticketsEscalated,
        overviewResponseDto.ticketsEscalated
      ) &&
      Objects.equals(this.openTickets, overviewResponseDto.openTickets) &&
      Objects.equals(this.deflection, overviewResponseDto.deflection) &&
      Objects.equals(this.csat, overviewResponseDto.csat) &&
      Objects.equals(
        this.humanFirstResponseSeconds,
        overviewResponseDto.humanFirstResponseSeconds
      ) &&
      Objects.equals(
        this.aiFirstResponseSeconds,
        overviewResponseDto.aiFirstResponseSeconds
      ) &&
      Objects.equals(
        this.resolutionSeconds,
        overviewResponseDto.resolutionSeconds
      ) &&
      Objects.equals(
        this.openTicketMedianAgeSeconds,
        overviewResponseDto.openTicketMedianAgeSeconds
      ) &&
      Objects.equals(this.computedAt, overviewResponseDto.computedAt) &&
      Objects.equals(this.dataThrough, overviewResponseDto.dataThrough)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      ticketsCreated,
      ticketsResolved,
      ticketsEscalated,
      openTickets,
      deflection,
      csat,
      humanFirstResponseSeconds,
      aiFirstResponseSeconds,
      resolutionSeconds,
      openTicketMedianAgeSeconds,
      computedAt,
      dataThrough
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class OverviewResponseDto {\n");
    sb.append("    ticketsCreated: ")
      .append(toIndentedString(ticketsCreated))
      .append("\n");
    sb.append("    ticketsResolved: ")
      .append(toIndentedString(ticketsResolved))
      .append("\n");
    sb.append("    ticketsEscalated: ")
      .append(toIndentedString(ticketsEscalated))
      .append("\n");
    sb.append("    openTickets: ")
      .append(toIndentedString(openTickets))
      .append("\n");
    sb.append("    deflection: ")
      .append(toIndentedString(deflection))
      .append("\n");
    sb.append("    csat: ").append(toIndentedString(csat)).append("\n");
    sb.append("    humanFirstResponseSeconds: ")
      .append(toIndentedString(humanFirstResponseSeconds))
      .append("\n");
    sb.append("    aiFirstResponseSeconds: ")
      .append(toIndentedString(aiFirstResponseSeconds))
      .append("\n");
    sb.append("    resolutionSeconds: ")
      .append(toIndentedString(resolutionSeconds))
      .append("\n");
    sb.append("    openTicketMedianAgeSeconds: ")
      .append(toIndentedString(openTicketMedianAgeSeconds))
      .append("\n");
    sb.append("    computedAt: ")
      .append(toIndentedString(computedAt))
      .append("\n");
    sb.append("    dataThrough: ")
      .append(toIndentedString(dataThrough))
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
