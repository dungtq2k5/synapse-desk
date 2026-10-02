package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.lang.Nullable;

/**
 * MarkManyReadDto
 */

public class MarkManyReadDto {

  private List<UUID> ids = new ArrayList<>();

  /**
   * Gets or Sets resourceType
   */
  public enum ResourceTypeEnum {
    DOCUMENT("DOCUMENT"),

    ORGANIZATION("ORGANIZATION"),

    TICKET("TICKET"),

    USER("USER");

    private final String value;

    ResourceTypeEnum(String value) {
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
    public static ResourceTypeEnum fromValue(String value) {
      for (ResourceTypeEnum b : ResourceTypeEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      throw new IllegalArgumentException("Unexpected value '" + value + "'");
    }
  }

  private @Nullable ResourceTypeEnum resourceType;

  private @Nullable UUID resourceId;

  public MarkManyReadDto ids(List<UUID> ids) {
    this.ids = ids;
    return this;
  }

  public MarkManyReadDto addIdsItem(UUID idsItem) {
    if (this.ids == null) {
      this.ids = new ArrayList<>();
    }
    this.ids.add(idsItem);
    return this;
  }

  /**
   * Get ids
   * @return ids
   */
  @Valid
  @JsonProperty("ids")
  public List<UUID> getIds() {
    return ids;
  }

  @JsonProperty("ids")
  public void setIds(List<UUID> ids) {
    this.ids = ids;
  }

  public MarkManyReadDto resourceType(@Nullable ResourceTypeEnum resourceType) {
    this.resourceType = resourceType;
    return this;
  }

  /**
   * Get resourceType
   * @return resourceType
   */

  @JsonProperty("resourceType")
  public @Nullable ResourceTypeEnum getResourceType() {
    return resourceType;
  }

  @JsonProperty("resourceType")
  public void setResourceType(@Nullable ResourceTypeEnum resourceType) {
    this.resourceType = resourceType;
  }

  public MarkManyReadDto resourceId(@Nullable UUID resourceId) {
    this.resourceId = resourceId;
    return this;
  }

  /**
   * Get resourceId
   * @return resourceId
   */
  @Valid
  @JsonProperty("resourceId")
  public @Nullable UUID getResourceId() {
    return resourceId;
  }

  @JsonProperty("resourceId")
  public void setResourceId(@Nullable UUID resourceId) {
    this.resourceId = resourceId;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    MarkManyReadDto markManyReadDto = (MarkManyReadDto) o;
    return (
      Objects.equals(this.ids, markManyReadDto.ids) &&
      Objects.equals(this.resourceType, markManyReadDto.resourceType) &&
      Objects.equals(this.resourceId, markManyReadDto.resourceId)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(ids, resourceType, resourceId);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class MarkManyReadDto {\n");
    sb.append("    ids: ").append(toIndentedString(ids)).append("\n");
    sb.append("    resourceType: ")
      .append(toIndentedString(resourceType))
      .append("\n");
    sb.append("    resourceId: ")
      .append(toIndentedString(resourceId))
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
