package com.synapsedesk.gateway.notifications;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import synapsedesk.notification.Notification.ListNotificationsResponse;
import synapsedesk.notification.Notification.NotificationPriority;
import synapsedesk.notification.Notification.NotificationResourceType;
import synapsedesk.notification.Notification.NotificationResponse;

/**
 * Wire `NotificationResponse` -> the GraphQL DTO. Reuses {@link
 * NotificationsController#TYPE_VALUES} for `type` — the one field REST and
 * GraphQL must never answer differently, since it is the dotted string a
 * client's own notification-type switch reads.
 */
public final class NotificationMapper {

  private NotificationMapper() {}

  public static NotificationFeedGqlDto toFeedGqlDto(
    ListNotificationsResponse response
  ) {
    return new NotificationFeedGqlDto(
      response
        .getItemsList()
        .stream()
        .map(NotificationMapper::toNotificationGqlDto)
        .toList(),
      response.hasNextCursor() ? response.getNextCursor() : null,
      response.getHasMore()
    );
  }

  public static NotificationGqlDto toNotificationGqlDto(
    NotificationResponse notification
  ) {
    return new NotificationGqlDto(
      notification.getId(),
      notification.getOrganizationId(),
      NotificationsController.TYPE_VALUES.get(notification.getType()),
      priorityStringOf(notification.getPriority()),
      notification.getTitle(),
      notification.hasBody() ? notification.getBody() : null,
      notification.hasActionUrl() ? notification.getActionUrl() : null,
      notification.hasActorId() ? notification.getActorId() : null,
      resourceTypeStringOf(notification.getResourceType()),
      notification.hasResourceId() ? notification.getResourceId() : null,
      notification.hasReadAt()
        ? toOffsetDateTime(notification.getReadAt())
        : null,
      notification.hasArchivedAt()
        ? toOffsetDateTime(notification.getArchivedAt())
        : null,
      toOffsetDateTime(notification.getCreatedAt())
    );
  }

  /** `UNSPECIFIED` -> `null`: no priority set is the same fact as no priority to report. */
  private static String priorityStringOf(NotificationPriority priority) {
    return priority == NotificationPriority.NOTIFICATION_PRIORITY_UNSPECIFIED
      ? null
      : priority.name().replace("NOTIFICATION_PRIORITY_", "");
  }

  /** `UNSPECIFIED` -> `null`: this notification is not about a resource. */
  private static String resourceTypeStringOf(
    NotificationResourceType resourceType
  ) {
    return resourceType ==
      NotificationResourceType.NOTIFICATION_RESOURCE_TYPE_UNSPECIFIED
      ? null
      : resourceType.name().replace("NOTIFICATION_RESOURCE_TYPE_", "");
  }

  private static OffsetDateTime toOffsetDateTime(
    com.google.protobuf.Timestamp timestamp
  ) {
    return Instant.ofEpochSecond(
      timestamp.getSeconds(),
      timestamp.getNanos()
    ).atOffset(ZoneOffset.UTC);
  }
}
