package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * GenerateDraftDto
 */

public class GenerateDraftDto {

  private @Nullable String instruction;

  public GenerateDraftDto instruction(@Nullable String instruction) {
    this.instruction = instruction;
    return this;
  }

  /**
   * An optional steer from the agent — \"shorter\", \"offer the refund\".  Absent means \"draft from the thread alone\", which is the ordinary case. Bounded because this is user text that reaches a model prompt: an unbounded field here is an unbounded token bill, quite apart from what someone could try to write into it.
   * @return instruction
   */
  @Size(min = 1, max = 500)
  @JsonProperty("instruction")
  public @Nullable String getInstruction() {
    return instruction;
  }

  @JsonProperty("instruction")
  public void setInstruction(@Nullable String instruction) {
    this.instruction = instruction;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    GenerateDraftDto generateDraftDto = (GenerateDraftDto) o;
    return Objects.equals(this.instruction, generateDraftDto.instruction);
  }

  @Override
  public int hashCode() {
    return Objects.hash(instruction);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class GenerateDraftDto {\n");
    sb.append("    instruction: ")
      .append(toIndentedString(instruction))
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
