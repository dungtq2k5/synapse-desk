package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.InvitationPreviewRowResponseDto;
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
 * PreviewInvitationsResponseDto
 */

public class PreviewInvitationsResponseDto {

  private List<@Valid InvitationPreviewRowResponseDto> rows = new ArrayList<>();

  private BigDecimal seatsInUse;

  private BigDecimal maxAgentSeats;

  private BigDecimal seatOverrun;

  public PreviewInvitationsResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PreviewInvitationsResponseDto(
    List<@Valid InvitationPreviewRowResponseDto> rows,
    BigDecimal seatsInUse,
    BigDecimal maxAgentSeats,
    BigDecimal seatOverrun
  ) {
    this.rows = rows;
    this.seatsInUse = seatsInUse;
    this.maxAgentSeats = maxAgentSeats;
    this.seatOverrun = seatOverrun;
  }

  public PreviewInvitationsResponseDto rows(
    List<@Valid InvitationPreviewRowResponseDto> rows
  ) {
    this.rows = rows;
    return this;
  }

  public PreviewInvitationsResponseDto addRowsItem(
    InvitationPreviewRowResponseDto rowsItem
  ) {
    if (this.rows == null) {
      this.rows = new ArrayList<>();
    }
    this.rows.add(rowsItem);
    return this;
  }

  /**
   * Get rows
   * @return rows
   */
  @NotNull
  @Valid
  @JsonProperty("rows")
  public List<@Valid InvitationPreviewRowResponseDto> getRows() {
    return rows;
  }

  @JsonProperty("rows")
  public void setRows(List<@Valid InvitationPreviewRowResponseDto> rows) {
    this.rows = rows;
  }

  public PreviewInvitationsResponseDto seatsInUse(BigDecimal seatsInUse) {
    this.seatsInUse = seatsInUse;
    return this;
  }

  /**
   * Get seatsInUse
   * @return seatsInUse
   */
  @NotNull
  @Valid
  @JsonProperty("seatsInUse")
  public BigDecimal getSeatsInUse() {
    return seatsInUse;
  }

  @JsonProperty("seatsInUse")
  public void setSeatsInUse(BigDecimal seatsInUse) {
    this.seatsInUse = seatsInUse;
  }

  public PreviewInvitationsResponseDto maxAgentSeats(BigDecimal maxAgentSeats) {
    this.maxAgentSeats = maxAgentSeats;
    return this;
  }

  /**
   * Get maxAgentSeats
   * @return maxAgentSeats
   */
  @NotNull
  @Valid
  @JsonProperty("maxAgentSeats")
  public BigDecimal getMaxAgentSeats() {
    return maxAgentSeats;
  }

  @JsonProperty("maxAgentSeats")
  public void setMaxAgentSeats(BigDecimal maxAgentSeats) {
    this.maxAgentSeats = maxAgentSeats;
  }

  public PreviewInvitationsResponseDto seatOverrun(BigDecimal seatOverrun) {
    this.seatOverrun = seatOverrun;
    return this;
  }

  /**
   * Non-zero means the batch would be partially rejected at commit time.
   * @return seatOverrun
   */
  @NotNull
  @Valid
  @JsonProperty("seatOverrun")
  public BigDecimal getSeatOverrun() {
    return seatOverrun;
  }

  @JsonProperty("seatOverrun")
  public void setSeatOverrun(BigDecimal seatOverrun) {
    this.seatOverrun = seatOverrun;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    PreviewInvitationsResponseDto previewInvitationsResponseDto =
      (PreviewInvitationsResponseDto) o;
    return (
      Objects.equals(this.rows, previewInvitationsResponseDto.rows) &&
      Objects.equals(
        this.seatsInUse,
        previewInvitationsResponseDto.seatsInUse
      ) &&
      Objects.equals(
        this.maxAgentSeats,
        previewInvitationsResponseDto.maxAgentSeats
      ) &&
      Objects.equals(
        this.seatOverrun,
        previewInvitationsResponseDto.seatOverrun
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(rows, seatsInUse, maxAgentSeats, seatOverrun);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PreviewInvitationsResponseDto {\n");
    sb.append("    rows: ").append(toIndentedString(rows)).append("\n");
    sb.append("    seatsInUse: ")
      .append(toIndentedString(seatsInUse))
      .append("\n");
    sb.append("    maxAgentSeats: ")
      .append(toIndentedString(maxAgentSeats))
      .append("\n");
    sb.append("    seatOverrun: ")
      .append(toIndentedString(seatOverrun))
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
