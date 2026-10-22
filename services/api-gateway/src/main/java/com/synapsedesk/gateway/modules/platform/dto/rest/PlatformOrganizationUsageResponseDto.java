package com.synapsedesk.gateway.modules.platform.dto.rest;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.modules.organizations.dto.rest.UsageMeterResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * An organization's meters, as its own usage page reads them.
 */

public class PlatformOrganizationUsageResponseDto {

  private UsageMeterResponseDto seats;

  private UsageMeterResponseDto storage;

  private UsageMeterResponseDto aiTokens;

  public PlatformOrganizationUsageResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public PlatformOrganizationUsageResponseDto(
    UsageMeterResponseDto seats,
    UsageMeterResponseDto storage,
    UsageMeterResponseDto aiTokens
  ) {
    this.seats = seats;
    this.storage = storage;
    this.aiTokens = aiTokens;
  }

  public PlatformOrganizationUsageResponseDto seats(
    UsageMeterResponseDto seats
  ) {
    this.seats = seats;
    return this;
  }

  /**
   * Get seats
   * @return seats
   */
  @NotNull
  @Valid
  @JsonProperty("seats")
  public UsageMeterResponseDto getSeats() {
    return seats;
  }

  @JsonProperty("seats")
  public void setSeats(UsageMeterResponseDto seats) {
    this.seats = seats;
  }

  public PlatformOrganizationUsageResponseDto storage(
    UsageMeterResponseDto storage
  ) {
    this.storage = storage;
    return this;
  }

  /**
   * Get storage
   * @return storage
   */
  @NotNull
  @Valid
  @JsonProperty("storage")
  public UsageMeterResponseDto getStorage() {
    return storage;
  }

  @JsonProperty("storage")
  public void setStorage(UsageMeterResponseDto storage) {
    this.storage = storage;
  }

  public PlatformOrganizationUsageResponseDto aiTokens(
    UsageMeterResponseDto aiTokens
  ) {
    this.aiTokens = aiTokens;
    return this;
  }

  /**
   * Get aiTokens
   * @return aiTokens
   */
  @NotNull
  @Valid
  @JsonProperty("aiTokens")
  public UsageMeterResponseDto getAiTokens() {
    return aiTokens;
  }

  @JsonProperty("aiTokens")
  public void setAiTokens(UsageMeterResponseDto aiTokens) {
    this.aiTokens = aiTokens;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    PlatformOrganizationUsageResponseDto platformOrganizationUsageResponseDto =
      (PlatformOrganizationUsageResponseDto) o;
    return (
      Objects.equals(this.seats, platformOrganizationUsageResponseDto.seats) &&
      Objects.equals(
        this.storage,
        platformOrganizationUsageResponseDto.storage
      ) &&
      Objects.equals(
        this.aiTokens,
        platformOrganizationUsageResponseDto.aiTokens
      )
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(seats, storage, aiTokens);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class PlatformOrganizationUsageResponseDto {\n");
    sb.append("    seats: ").append(toIndentedString(seats)).append("\n");
    sb.append("    storage: ").append(toIndentedString(storage)).append("\n");
    sb.append("    aiTokens: ").append(toIndentedString(aiTokens)).append("\n");
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
