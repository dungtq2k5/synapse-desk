package com.synapsedesk.gateway.notifications;

import java.time.OffsetDateTime;

/**
 * `Notification`, as the GraphQL schema serves it — `data` and `groupKey`
 * absent, matching Node's `NotificationResponseGqlDto`: `data` is an untyped
 * bag with no honest GraphQL type, and `groupKey` means nothing to a client.
 */
public record NotificationGqlDto(
    String id,
    String organizationId,
    String type,
    String priority,
    String title,
    String body,
    String actionUrl,
    String actorId,
    String resourceType,
    String resourceId,
    OffsetDateTime readAt,
    OffsetDateTime archivedAt,
    OffsetDateTime createdAt) {}
