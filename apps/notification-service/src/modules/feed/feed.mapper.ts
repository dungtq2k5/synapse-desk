import {
  DeviceTokenResponse,
  toProtoDevicePlatform,
  NotificationResponse,
  toProtoNotificationPriority,
  toProtoNotificationResourceType,
  toProtoNotificationType,
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
    // `type`, `priority` and `resource_type` are all `VarChar` columns, so each
    // arrives as a plain string and each crosses through its bridge. An
    // unrecognized value answers `UNSPECIFIED` rather than throwing: a single
    // malformed row must not take the whole page down.
    type: toProtoNotificationType(notification.type),
    priority: toProtoNotificationPriority(notification.priority),
    title: notification.title,
    // `?? undefined`, never `?? ''`: these fields are `optional` on the wire,
    // and an empty string is a body the SPA would render as a blank line.
    body: notification.body ?? undefined,
    data: JSON.stringify(notification.data ?? {}),
    actionUrl: notification.actionUrl ?? undefined,
    actorId: notification.actorId ?? undefined,
    resourceType: toProtoNotificationResourceType(notification.resourceType),
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

/**
 * A device row, WITHOUT its token.
 *
 * The token is a credential; a settings screen needs an id to delete by and a
 * name to show. Putting it on the wire would spread a secret to every client
 * that lists devices, for no reader.
 */
export function toDeviceTokenResponse(device: {
  id: string;
  platform: string;
  deviceName: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}): DeviceTokenResponse {
  return {
    id: device.id,
    platform: toProtoDevicePlatform(device.platform),
    deviceName: device.deviceName ?? undefined,
    lastUsedAt: toProtoTimestamp(device.lastUsedAt),
    createdAt: toProtoTimestamp(device.createdAt),
  };
}
