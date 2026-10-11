package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import com.synapsedesk.gateway.common.validation.StrictIso8601;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * UpdateOwnProfileDto
 */

public class UpdateOwnProfileDto {

  private @Nullable String fullName;

  /**
   * Gets or Sets gender
   */
  public enum GenderEnum {
    FEMALE("FEMALE"),

    MALE("MALE"),

    OTHER("OTHER"),

    UNSPECIFIED("UNSPECIFIED");

    private final String value;

    GenderEnum(String value) {
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
    public static GenderEnum fromValue(String value) {
      for (GenderEnum b : GenderEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private @Nullable GenderEnum gender;

  private @Nullable String dob = null;

  public UpdateOwnProfileDto fullName(@Nullable String fullName) {
    this.fullName = fullName;
    return this;
  }

  /**
   * Get fullName
   * @return fullName
   */
  @Size(min = 2, max = 150)
  @JsonProperty("fullName")
  public @Nullable String getFullName() {
    return fullName;
  }

  @JsonProperty("fullName")
  public void setFullName(@Nullable String fullName) {
    this.fullName = fullName;
  }

  public UpdateOwnProfileDto gender(@Nullable GenderEnum gender) {
    this.gender = gender;
    return this;
  }

  /**
   * Get gender
   * @return gender
   */

  @JsonProperty("gender")
  public @Nullable GenderEnum getGender() {
    return gender;
  }

  @JsonProperty("gender")
  public void setGender(@Nullable GenderEnum gender) {
    this.gender = gender;
  }

  public UpdateOwnProfileDto dob(@Nullable String dob) {
    this.dob = dob;
    return this;
  }

  /**
   * Date of birth as ISO `YYYY-MM-DD` — a calendar date, no time, no zone.
   * @return dob
   */

  @StrictIso8601
  @JsonProperty("dob")
  public @Nullable String getDob() {
    return dob;
  }

  @JsonProperty("dob")
  public void setDob(@Nullable String dob) {
    this.dob = dob;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UpdateOwnProfileDto updateOwnProfileDto = (UpdateOwnProfileDto) o;
    return (
      Objects.equals(this.fullName, updateOwnProfileDto.fullName) &&
      Objects.equals(this.gender, updateOwnProfileDto.gender) &&
      Objects.equals(this.dob, updateOwnProfileDto.dob)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(fullName, gender, dob);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UpdateOwnProfileDto {\n");
    sb.append("    fullName: ").append(toIndentedString(fullName)).append("\n");
    sb.append("    gender: ").append(toIndentedString(gender)).append("\n");
    sb.append("    dob: ").append(toIndentedString(dob)).append("\n");
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
