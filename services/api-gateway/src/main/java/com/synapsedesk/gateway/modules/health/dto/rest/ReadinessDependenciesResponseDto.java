package com.synapsedesk.gateway.modules.health.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * ReadinessDependenciesResponseDto
 */

public class ReadinessDependenciesResponseDto {

  /**
   * Gets or Sets redis
   */
  public enum RedisEnum {
    DOWN("DOWN"),

    UNKNOWN("UNKNOWN"),

    UP("UP");

    private final String value;

    RedisEnum(String value) {
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
    public static RedisEnum fromValue(String value) {
      for (RedisEnum b : RedisEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private RedisEnum redis;

  public ReadinessDependenciesResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ReadinessDependenciesResponseDto(RedisEnum redis) {
    this.redis = redis;
  }

  public ReadinessDependenciesResponseDto redis(RedisEnum redis) {
    this.redis = redis;
    return this;
  }

  /**
   * Get redis
   * @return redis
   */
  @NotNull
  @JsonProperty("redis")
  public RedisEnum getRedis() {
    return redis;
  }

  @JsonProperty("redis")
  public void setRedis(RedisEnum redis) {
    this.redis = redis;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    ReadinessDependenciesResponseDto readinessDependenciesResponseDto =
      (ReadinessDependenciesResponseDto) o;
    return Objects.equals(this.redis, readinessDependenciesResponseDto.redis);
  }

  @Override
  public int hashCode() {
    return Objects.hash(redis);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ReadinessDependenciesResponseDto {\n");
    sb.append("    redis: ").append(toIndentedString(redis)).append("\n");
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
