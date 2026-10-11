package com.synapsedesk.gateway.common.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * UserResponseDto
 */

public class UserResponseDto {

  private UUID id;

  private UUID organizationId = null;

  private String fullName;

  private URI avatarUrl = null;

  private String email;

  private Boolean isEmailVerified;

  private String phoneNumber = null;

  private Boolean isPhoneVerified;

  private String dob = null;

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

  private GenderEnum gender;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime lastLoginAt = null;

  private Boolean isLocked;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime lockedUntil = null;

  private Boolean isTwoFactorEnabled;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime createdAt;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime updatedAt;

  public UserResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public UserResponseDto(
    UUID id,
    UUID organizationId,
    String fullName,
    URI avatarUrl,
    String email,
    Boolean isEmailVerified,
    String phoneNumber,
    Boolean isPhoneVerified,
    String dob,
    GenderEnum gender,
    OffsetDateTime lastLoginAt,
    Boolean isLocked,
    OffsetDateTime lockedUntil,
    Boolean isTwoFactorEnabled,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
  ) {
    this.id = id;
    this.organizationId = organizationId;
    this.fullName = fullName;
    this.avatarUrl = avatarUrl;
    this.email = email;
    this.isEmailVerified = isEmailVerified;
    this.phoneNumber = phoneNumber;
    this.isPhoneVerified = isPhoneVerified;
    this.dob = dob;
    this.gender = gender;
    this.lastLoginAt = lastLoginAt;
    this.isLocked = isLocked;
    this.lockedUntil = lockedUntil;
    this.isTwoFactorEnabled = isTwoFactorEnabled;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  public UserResponseDto id(UUID id) {
    this.id = id;
    return this;
  }

  /**
   * Get id
   * @return id
   */
  @NotNull
  @Valid
  @JsonProperty("id")
  public UUID getId() {
    return id;
  }

  @JsonProperty("id")
  public void setId(UUID id) {
    this.id = id;
  }

  public UserResponseDto organizationId(UUID organizationId) {
    this.organizationId = organizationId;
    return this;
  }

  /**
   * null for platform Super Admins, who belong to no tenant (RDM). Typed non-nullable, this field made the seeded super admin impossible to return from the API at all.
   * @return organizationId
   */
  @Valid
  @JsonProperty("organizationId")
  public UUID getOrganizationId() {
    return organizationId;
  }

  @JsonProperty("organizationId")
  public void setOrganizationId(UUID organizationId) {
    this.organizationId = organizationId;
  }

  public UserResponseDto fullName(String fullName) {
    this.fullName = fullName;
    return this;
  }

  /**
   * Get fullName
   * @return fullName
   */
  @NotNull
  @JsonProperty("fullName")
  public String getFullName() {
    return fullName;
  }

  @JsonProperty("fullName")
  public void setFullName(String fullName) {
    this.fullName = fullName;
  }

  public UserResponseDto avatarUrl(URI avatarUrl) {
    this.avatarUrl = avatarUrl;
    return this;
  }

  /**
   * Get avatarUrl
   * @return avatarUrl
   */
  @Valid
  @JsonProperty("avatarUrl")
  public URI getAvatarUrl() {
    return avatarUrl;
  }

  @JsonProperty("avatarUrl")
  public void setAvatarUrl(URI avatarUrl) {
    this.avatarUrl = avatarUrl;
  }

  public UserResponseDto email(String email) {
    this.email = email;
    return this;
  }

  /**
   * Get email
   * @return email
   */
  @NotNull
  @jakarta.validation.constraints.Email
  @JsonProperty("email")
  public String getEmail() {
    return email;
  }

  @JsonProperty("email")
  public void setEmail(String email) {
    this.email = email;
  }

  public UserResponseDto isEmailVerified(Boolean isEmailVerified) {
    this.isEmailVerified = isEmailVerified;
    return this;
  }

  /**
   * Get isEmailVerified
   * @return isEmailVerified
   */
  @NotNull
  @JsonProperty("isEmailVerified")
  public Boolean getIsEmailVerified() {
    return isEmailVerified;
  }

  @JsonProperty("isEmailVerified")
  public void setIsEmailVerified(Boolean isEmailVerified) {
    this.isEmailVerified = isEmailVerified;
  }

  public UserResponseDto phoneNumber(String phoneNumber) {
    this.phoneNumber = phoneNumber;
    return this;
  }

  /**
   * Get phoneNumber
   * @return phoneNumber
   */

  @JsonProperty("phoneNumber")
  public String getPhoneNumber() {
    return phoneNumber;
  }

  @JsonProperty("phoneNumber")
  public void setPhoneNumber(String phoneNumber) {
    this.phoneNumber = phoneNumber;
  }

  public UserResponseDto isPhoneVerified(Boolean isPhoneVerified) {
    this.isPhoneVerified = isPhoneVerified;
    return this;
  }

  /**
   * Get isPhoneVerified
   * @return isPhoneVerified
   */
  @NotNull
  @JsonProperty("isPhoneVerified")
  public Boolean getIsPhoneVerified() {
    return isPhoneVerified;
  }

  @JsonProperty("isPhoneVerified")
  public void setIsPhoneVerified(Boolean isPhoneVerified) {
    this.isPhoneVerified = isPhoneVerified;
  }

  public UserResponseDto dob(String dob) {
    this.dob = dob;
    return this;
  }

  /**
   * Date of birth as ISO `YYYY-MM-DD` — a calendar date, with no time and no zone. `null` when the user has not given one.
   * @return dob
   */

  @JsonProperty("dob")
  public String getDob() {
    return dob;
  }

  @JsonProperty("dob")
  public void setDob(String dob) {
    this.dob = dob;
  }

  public UserResponseDto gender(GenderEnum gender) {
    this.gender = gender;
    return this;
  }

  /**
   * Get gender
   * @return gender
   */
  @NotNull
  @JsonProperty("gender")
  public GenderEnum getGender() {
    return gender;
  }

  @JsonProperty("gender")
  public void setGender(GenderEnum gender) {
    this.gender = gender;
  }

  public UserResponseDto lastLoginAt(OffsetDateTime lastLoginAt) {
    this.lastLoginAt = lastLoginAt;
    return this;
  }

  /**
   * Get lastLoginAt
   * @return lastLoginAt
   */
  @Valid
  @JsonProperty("lastLoginAt")
  public OffsetDateTime getLastLoginAt() {
    return lastLoginAt;
  }

  @JsonProperty("lastLoginAt")
  public void setLastLoginAt(OffsetDateTime lastLoginAt) {
    this.lastLoginAt = lastLoginAt;
  }

  public UserResponseDto isLocked(Boolean isLocked) {
    this.isLocked = isLocked;
    return this;
  }

  /**
   * Get isLocked
   * @return isLocked
   */
  @NotNull
  @JsonProperty("isLocked")
  public Boolean getIsLocked() {
    return isLocked;
  }

  @JsonProperty("isLocked")
  public void setIsLocked(Boolean isLocked) {
    this.isLocked = isLocked;
  }

  public UserResponseDto lockedUntil(OffsetDateTime lockedUntil) {
    this.lockedUntil = lockedUntil;
    return this;
  }

  /**
   * When a temporary lock lapses. `null` means the lock is INDEFINITE.  Render on `isLocked`; read this to show *when* the lock ends.
   * @return lockedUntil
   */
  @Valid
  @JsonProperty("lockedUntil")
  public OffsetDateTime getLockedUntil() {
    return lockedUntil;
  }

  @JsonProperty("lockedUntil")
  public void setLockedUntil(OffsetDateTime lockedUntil) {
    this.lockedUntil = lockedUntil;
  }

  public UserResponseDto isTwoFactorEnabled(Boolean isTwoFactorEnabled) {
    this.isTwoFactorEnabled = isTwoFactorEnabled;
    return this;
  }

  /**
   * Get isTwoFactorEnabled
   * @return isTwoFactorEnabled
   */
  @NotNull
  @JsonProperty("isTwoFactorEnabled")
  public Boolean getIsTwoFactorEnabled() {
    return isTwoFactorEnabled;
  }

  @JsonProperty("isTwoFactorEnabled")
  public void setIsTwoFactorEnabled(Boolean isTwoFactorEnabled) {
    this.isTwoFactorEnabled = isTwoFactorEnabled;
  }

  public UserResponseDto createdAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
    return this;
  }

  /**
   * Get createdAt
   * @return createdAt
   */
  @NotNull
  @Valid
  @JsonProperty("createdAt")
  public OffsetDateTime getCreatedAt() {
    return createdAt;
  }

  @JsonProperty("createdAt")
  public void setCreatedAt(OffsetDateTime createdAt) {
    this.createdAt = createdAt;
  }

  public UserResponseDto updatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
    return this;
  }

  /**
   * Get updatedAt
   * @return updatedAt
   */
  @NotNull
  @Valid
  @JsonProperty("updatedAt")
  public OffsetDateTime getUpdatedAt() {
    return updatedAt;
  }

  @JsonProperty("updatedAt")
  public void setUpdatedAt(OffsetDateTime updatedAt) {
    this.updatedAt = updatedAt;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    UserResponseDto userResponseDto = (UserResponseDto) o;
    return (
      Objects.equals(this.id, userResponseDto.id) &&
      Objects.equals(this.organizationId, userResponseDto.organizationId) &&
      Objects.equals(this.fullName, userResponseDto.fullName) &&
      Objects.equals(this.avatarUrl, userResponseDto.avatarUrl) &&
      Objects.equals(this.email, userResponseDto.email) &&
      Objects.equals(this.isEmailVerified, userResponseDto.isEmailVerified) &&
      Objects.equals(this.phoneNumber, userResponseDto.phoneNumber) &&
      Objects.equals(this.isPhoneVerified, userResponseDto.isPhoneVerified) &&
      Objects.equals(this.dob, userResponseDto.dob) &&
      Objects.equals(this.gender, userResponseDto.gender) &&
      Objects.equals(this.lastLoginAt, userResponseDto.lastLoginAt) &&
      Objects.equals(this.isLocked, userResponseDto.isLocked) &&
      Objects.equals(this.lockedUntil, userResponseDto.lockedUntil) &&
      Objects.equals(
        this.isTwoFactorEnabled,
        userResponseDto.isTwoFactorEnabled
      ) &&
      Objects.equals(this.createdAt, userResponseDto.createdAt) &&
      Objects.equals(this.updatedAt, userResponseDto.updatedAt)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(
      id,
      organizationId,
      fullName,
      avatarUrl,
      email,
      isEmailVerified,
      phoneNumber,
      isPhoneVerified,
      dob,
      gender,
      lastLoginAt,
      isLocked,
      lockedUntil,
      isTwoFactorEnabled,
      createdAt,
      updatedAt
    );
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class UserResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    organizationId: ")
      .append(toIndentedString(organizationId))
      .append("\n");
    sb.append("    fullName: ").append(toIndentedString(fullName)).append("\n");
    sb.append("    avatarUrl: ")
      .append(toIndentedString(avatarUrl))
      .append("\n");
    sb.append("    email: ").append(toIndentedString(email)).append("\n");
    sb.append("    isEmailVerified: ")
      .append(toIndentedString(isEmailVerified))
      .append("\n");
    sb.append("    phoneNumber: ")
      .append(toIndentedString(phoneNumber))
      .append("\n");
    sb.append("    isPhoneVerified: ")
      .append(toIndentedString(isPhoneVerified))
      .append("\n");
    sb.append("    dob: ").append(toIndentedString(dob)).append("\n");
    sb.append("    gender: ").append(toIndentedString(gender)).append("\n");
    sb.append("    lastLoginAt: ")
      .append(toIndentedString(lastLoginAt))
      .append("\n");
    sb.append("    isLocked: ").append(toIndentedString(isLocked)).append("\n");
    sb.append("    lockedUntil: ")
      .append(toIndentedString(lockedUntil))
      .append("\n");
    sb.append("    isTwoFactorEnabled: ")
      .append(toIndentedString(isTwoFactorEnabled))
      .append("\n");
    sb.append("    createdAt: ")
      .append(toIndentedString(createdAt))
      .append("\n");
    sb.append("    updatedAt: ")
      .append(toIndentedString(updatedAt))
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
