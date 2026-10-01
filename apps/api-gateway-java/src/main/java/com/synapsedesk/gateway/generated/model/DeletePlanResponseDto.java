package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * DeletePlanResponseDto
 */

public class DeletePlanResponseDto {

  private Boolean deleted;

  public DeletePlanResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public DeletePlanResponseDto(Boolean deleted) {
    this.deleted = deleted;
  }

  public DeletePlanResponseDto deleted(Boolean deleted) {
    this.deleted = deleted;
    return this;
  }

  /**
   * Get deleted
   * @return deleted
   */
  @NotNull 
  @JsonProperty("deleted")
  public Boolean getDeleted() {
    return deleted;
  }

  @JsonProperty("deleted")
  public void setDeleted(Boolean deleted) {
    this.deleted = deleted;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    DeletePlanResponseDto deletePlanResponseDto = (DeletePlanResponseDto) o;
    return Objects.equals(this.deleted, deletePlanResponseDto.deleted);
  }

  @Override
  public int hashCode() {
    return Objects.hash(deleted);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class DeletePlanResponseDto {\n");
    sb.append("    deleted: ").append(toIndentedString(deleted)).append("\n");
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

