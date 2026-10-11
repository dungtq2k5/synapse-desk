package com.synapsedesk.gateway.modules.notifications.dto.graphql;

import java.util.List;

/** `NotificationFeed` — cursor-paginated, unlike every other list (the feed grows at the head). */
public record NotificationFeedGqlDto(
  List<NotificationGqlDto> items,
  String nextCursor,
  boolean hasMore
) {}
