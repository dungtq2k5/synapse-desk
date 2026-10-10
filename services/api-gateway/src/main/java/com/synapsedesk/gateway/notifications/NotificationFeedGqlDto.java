package com.synapsedesk.gateway.notifications;

import java.util.List;

/** `NotificationFeed` — cursor-paginated, unlike every other list (the feed grows at the head). */
public record NotificationFeedGqlDto(
  List<NotificationGqlDto> items,
  String nextCursor,
  boolean hasMore
) {}
