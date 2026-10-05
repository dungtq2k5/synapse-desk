package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.NotificationResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * NotificationFeedResponseDto
 */

public class NotificationFeedResponseDto {

  private List<@Valid NotificationResponseDto> items = new ArrayList<>();

  private String nextCursor = null;

  private Boolean hasMore;

  public NotificationFeedResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public NotificationFeedResponseDto(
    List<@Valid NotificationResponseDto> items,
    String nextCursor,
    Boolean hasMore
  ) {
    this.items = items;
    this.nextCursor = nextCursor;
    this.hasMore = hasMore;
  }

  public NotificationFeedResponseDto items(
    List<@Valid NotificationResponseDto> items
  ) {
    this.items = items;
    return this;
  }

  public NotificationFeedResponseDto addItemsItem(
    NotificationResponseDto itemsItem
  ) {
    if (this.items == null) {
      this.items = new ArrayList<>();
    }
    this.items.add(itemsItem);
    return this;
  }

  /**
   * Get items
   * @return items
   */
  @NotNull
  @Valid
  @JsonProperty("items")
  public List<@Valid NotificationResponseDto> getItems() {
    return items;
  }

  @JsonProperty("items")
  public void setItems(List<@Valid NotificationResponseDto> items) {
    this.items = items;
  }

  public NotificationFeedResponseDto nextCursor(String nextCursor) {
    this.nextCursor = nextCursor;
    return this;
  }

  /**
   * null on the last page — a client that keeps polling gets nothing forever.
   * @return nextCursor
   */

  @JsonProperty("nextCursor")
  public String getNextCursor() {
    return nextCursor;
  }

  @JsonProperty("nextCursor")
  public void setNextCursor(String nextCursor) {
    this.nextCursor = nextCursor;
  }

  public NotificationFeedResponseDto hasMore(Boolean hasMore) {
    this.hasMore = hasMore;
    return this;
  }

  /**
   * Get hasMore
   * @return hasMore
   */
  @NotNull
  @JsonProperty("hasMore")
  public Boolean getHasMore() {
    return hasMore;
  }

  @JsonProperty("hasMore")
  public void setHasMore(Boolean hasMore) {
    this.hasMore = hasMore;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    NotificationFeedResponseDto notificationFeedResponseDto =
      (NotificationFeedResponseDto) o;
    return (
      Objects.equals(this.items, notificationFeedResponseDto.items) &&
      Objects.equals(this.nextCursor, notificationFeedResponseDto.nextCursor) &&
      Objects.equals(this.hasMore, notificationFeedResponseDto.hasMore)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(items, nextCursor, hasMore);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class NotificationFeedResponseDto {\n");
    sb.append("    items: ").append(toIndentedString(items)).append("\n");
    sb.append("    nextCursor: ")
      .append(toIndentedString(nextCursor))
      .append("\n");
    sb.append("    hasMore: ").append(toIndentedString(hasMore)).append("\n");
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
