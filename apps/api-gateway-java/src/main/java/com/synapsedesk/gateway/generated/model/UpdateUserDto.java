package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * UpdateUserDto
 */

public class UpdateUserDto {

  private @Nullable String fullName;

  private @Nullable String phoneNumber = null;

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

  public UpdateUserDto fullName(@Nullable String fullName) {
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

  public UpdateUserDto phoneNumber(@Nullable String phoneNumber) {
    this.phoneNumber = phoneNumber;
    return this;
  }

  /**
   * Get phoneNumber
   * @return phoneNumber
   */
  
  @JsonProperty("phoneNumber")
  public @Nullable String getPhoneNumber() {
    return phoneNumber;
  }

  @JsonProperty("phoneNumber")
  public void setPhoneNumber(@Nullable String phoneNumber) {
    this.phoneNumber = phoneNumber;
  }

  public UpdateUserDto gender(@Nullable GenderEnum gender) {
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

  public UpdateUserDto dob(@Nullable String dob) {
    this.dob = dob;
    return this;
  }

  /**
   * Date of birth as ISO `YYYY-MM-DD` — a calendar date, no time, no zone.
   * @return dob
   */
  
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
    UpdateUserDto updateUserDto = (UpdateUserDto) o;
    return Objects.equals(this.fullName, updateUserDto.fullName) &&
        Objects.equals(this.phoneNumber, updateUserDto.phoneNumber) &&
        Objects.equals(this.gender, updateUserDto.gender) &&
        Objects.equals(this.dob, updateUserDto.dob);
  }

  @Override
  public int hashCode() {
    return Objects.hash(fullName, phoneNumber, gender, dob);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UpdateUserDto {\n");
    sb.append("    fullName: ").append(toIndentedString(fullName)).append("\n");
    sb.append("    phoneNumber: ").append(toIndentedString(phoneNumber)).append("\n");
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

