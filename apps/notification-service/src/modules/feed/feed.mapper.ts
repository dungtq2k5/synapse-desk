import {
  NotificationResponse,
  toProtoNotificationPriority,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { Notification } from '../../generated/prisma/client';

/**
 * Row → wire.
 *
 * `data` is serialized to a STRING rather than sent as a `Struct`: proto3 has
 * no `map<string, any>`, and a `Struct` would make every client depend on the
 * well-known types to read a deep-link payload it forwards to the SPA verbatim.
 * The gateway parses it back once, at the boundary that already speaks JSON.
 */
export function toNotificationResponse(
  notification: Notification,
): NotificationResponse {
  return {
    id: notification.id,
    organizationId: notification.organizationId,
    type: notification.type,
    // A `VarChar` column, so this is a plain string out of Prisma and
    // the mapper takes it as one.
    priority: toProtoNotificationPriority(notification.priority),
    title: notification.title,
    // `?? undefined`, never `?? ''`: these fields are `optional` on the wire,
    // and an empty string is a body the SPA would render as a blank line.
    body: notification.body ?? undefined,
    data: JSON.stringify(notification.data ?? {}),
    actionUrl: notification.actionUrl ?? undefined,
    actorId: notification.actorId ?? undefined,
    resourceType: notification.resourceType ?? undefined,
    resourceId: notification.resourceId ?? undefined,
    groupKey: notification.groupKey ?? undefined,
    groupCount: notification.groupCount,
    readAt: notification.readAt
      ? toProtoTimestamp(notification.readAt)
      : undefined,
    archivedAt: notification.archivedAt
      ? toProtoTimestamp(notification.archivedAt)
      : undefined,
    createdAt: toProtoTimestamp(notification.createdAt),
  };
}
