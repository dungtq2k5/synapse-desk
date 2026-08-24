import {
  fromProtoDigestMode,
  fromProtoNotificationChannel,
  fromProtoNotificationPriority,
  fromProtoNotificationResourceType,
  fromProtoNotificationType,
  toProtoNotificationResourceType,
  toProtoNotificationType,
  fromProtoPreferenceSource,
  fromProtoTimestamp,
  ListNotificationsResponse,
  ListPreferencesResponse,
  MarkReadRequest,
  NotificationResponse,
  PreferenceResponse,
  requireProtoTimestamp,
  toProtoDigestMode,
  toProtoNotificationChannel,
  UpdatePreferenceRequest,
  ListNotificationsRequest,
} from '@synapsedesk/grpc-proto';
import {
  NOTIFICATION_TYPE_VALUES,
  NotificationType,
  PREFERENCE_WILDCARD_TYPE,
} from '@synapsedesk/common';
import {
  ListNotificationsQueryDto,
  MarkManyReadDto,
  UpdatePreferenceDto,
} from './dto/rest/notification.dto';
import {
  NotificationFeedResponseDto,
  NotificationResponseDto,
  PreferenceResponseDto,
} from './dto/rest/notification-response.dto';

/**
 * Wire → REST, and `data` is parsed back into an object here.
 *
 * It crosses gRPC as a JSON string because proto3 has no `map<string, any>`;
 * a client should never see the encoding the transport needed. Parsing is
 * guarded because the alternative — a malformed payload failing the whole feed
 * — would take out every notification for one bad row.
 */
export function toNotificationResponseDto(
  notification: NotificationResponse,
): NotificationResponseDto {
  return {
    id: notification.id,
    organizationId: notification.organizationId,
    type: fromProtoNotificationType(notification.type),
    // `?? null`, never `?? ''`: an empty string is neither a member of the enum
    // nor an absence, so a client switching on it falls through every arm.
    priority: fromProtoNotificationPriority(notification.priority) ?? null,
    title: notification.title,
    body: notification.body ?? null,
    data: parseData(notification.data),
    actionUrl: notification.actionUrl ?? null,
    actorId: notification.actorId ?? null,
    resourceType: fromProtoNotificationResourceType(notification.resourceType),
    resourceId: notification.resourceId ?? null,
    groupKey: notification.groupKey ?? null,
    groupCount: notification.groupCount,
    readAt: fromProtoTimestamp(notification.readAt) ?? null,
    archivedAt: fromProtoTimestamp(notification.archivedAt) ?? null,
    createdAt: requireProtoTimestamp(notification.createdAt, 'createdAt'),
  };
}

/**
 * Wire → REST for one resolved preference.
 *
 * The three enum fields become their domain STRINGS here. A REST client reads
 * `"EMAIL"`, never the wire's `2` — the numbering is a protobuf encoding
 * detail, and publishing it would make every HTTP consumer depend on the proto
 * file to interpret a settings screen.
 *
 * `?? ''` on each, matching `toOrganizationResponseDto`: `UNSPECIFIED` means the field
 * was not set, and there is no member to honestly read that as. It should not
 * arise — the service maps from validated rows — so degrading to empty beats
 * failing a read the user is entitled to.
 */
export function toPreferenceResponseDto(
  preference: PreferenceResponse,
): PreferenceResponseDto {
  return {
    type: asPreferenceType(preference.type),
    channel: fromProtoNotificationChannel(preference.channel) ?? null,
    isEnabled: preference.isEnabled,
    digest: fromProtoDigestMode(preference.digest) ?? null,
    source: fromProtoPreferenceSource(preference.source) ?? null,
  };
}

/**
 * Narrows a PREFERENCE's `type`, which the wire still carries as a string.
 *
 * A notification's own `type` is a proto enum and crosses through
 * `fromProtoNotificationType`; this one cannot, because `'*'` is a legal
 * preference key and no notification may carry it — see `notification.proto`.
 * So the string check survives here and only here.
 */
function asPreferenceType(
  value: string,
): NotificationType | typeof PREFERENCE_WILDCARD_TYPE | null {
  if (value === PREFERENCE_WILDCARD_TYPE) return PREFERENCE_WILDCARD_TYPE;

  return NOTIFICATION_TYPE_VALUES.includes(value as NotificationType)
    ? (value as NotificationType)
    : null;
}

function parseData(raw: string): Record<string, unknown> {
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Converts a `ListNotificationsResponse` into the cursor-paginated feed DTO. */
export function toNotificationFeedDto(
  response: ListNotificationsResponse,
): NotificationFeedResponseDto {
  return {
    items: response.items.map(toNotificationResponseDto),
    // `?? null`: proto3 `optional` arrives as undefined, and a client checking
    // `nextCursor !== null` would loop forever on undefined.
    nextCursor: response.nextCursor ?? null,
    hasMore: response.hasMore,
  };
}

/** Converts a `ListPreferencesResponse` off the wire into its REST DTOs. */
export function toPreferenceResponseDtos(
  response: ListPreferencesResponse,
): PreferenceResponseDto[] {
  return response.items.map(toPreferenceResponseDto);
}

/** Builds a `ListNotificationsRequest` from the REST query. */
export function toListNotificationsRequest(
  query: ListNotificationsQueryDto,
): ListNotificationsRequest {
  return {
    type: toProtoNotificationType(query.type),
    unreadOnly: query.unreadOnly,
    includeArchived: query.includeArchived,
    cursor: query.cursor,
    limit: query.limit,
  };
}

/** Builds a `MarkReadRequest` from the REST body. */
export function toMarkReadRequest(dto: MarkManyReadDto): MarkReadRequest {
  return {
    ids: dto.ids,
    resourceType: toProtoNotificationResourceType(dto.resourceType),
    resourceId: dto.resourceId,
  };
}

/**
 * Builds an `UpdatePreferenceRequest` from the REST body.
 *
 * An omitted `digest` becomes `UNSPECIFIED`, which the service reads as "the
 * client did not send one" — so a PATCH carrying only `isEnabled` leaves a
 * chosen digest alone.
 */
export function toUpdatePreferenceRequest(
  dto: UpdatePreferenceDto,
): UpdatePreferenceRequest {
  return {
    type: dto.type,
    channel: toProtoNotificationChannel(dto.channel),
    isEnabled: dto.isEnabled,
    digest: toProtoDigestMode(dto.digest ?? ''),
  };
}
