import {
  DigestMode,
  NotificationChannel,
  NotificationPriority,
  NotificationResourceType,
  NotificationType,
  PreferenceSource,
  PREFERENCE_WILDCARD_TYPE,
  type DevicePlatform,
} from '@synapsedesk/common';

/**
 * The feed's response shapes — api-endpoints-plan §4b.
 *
 * **REST only.** The schema's `type Notification` is
 * `NotificationResponseGqlDto` in `../graphql/`;
 * `notification-response.contract.spec.ts` checks the two agree and records
 * `data`, `groupKey` and `groupCount` as deliberate REST-only fields.
 *
 * `data` arrives from gRPC as a JSON STRING (proto3 has no `map<string, any>`)
 * and is parsed back here, at the one boundary that already speaks JSON. A
 * client should never see the encoding the transport needed.
 */
export class NotificationResponseDto {
  id!: string;
  organizationId!: string;
  /**
   * The ORIGINATING event — `ticket.assigned`, never the NATS subject.
   *
   * `null` for a type this build does not recognise.
   */
  type!: NotificationType | null;
  /** How urgent it is. `null` when the wire value is one this build cannot name. */
  priority!: NotificationPriority | null;
  title!: string;
  body!: string | null;
  /** The event's payload, decoded from the JSON string the wire carries. */
  data!: Record<string, unknown>;
  actionUrl!: string | null;
  actorId!: string | null;
  /** What the notification is ABOUT. `null` when unset or unrecognized. */
  resourceType!: NotificationResourceType | null;
  resourceId!: string | null;
  /**
   * What collapses several events into one row — free-form, and deliberately
   * not an enum: the service composes it from a resource id.
   */
  groupKey!: string | null;
  /** "12 new messages on #1042" — how many events this row represents. */
  groupCount!: number;
  readAt!: Date | null;
  archivedAt!: Date | null;
  createdAt!: Date;
}

/**
 * CURSOR pagination, so the envelope is deliberately NOT `PaginationResponseDto`.
 *
 * That base carries `page`, `totalPages` and `totalItems`, none of which a
 * cursor feed can answer honestly: there is no page number, and a total that
 * changes between two requests is a number the client would render as though it
 * were stable. `nextCursor` plus `hasMore` is the whole contract.
 */
export class NotificationFeedResponseDto {
  items!: NotificationResponseDto[];
  /** null on the last page — a client that keeps polling gets nothing forever. */
  nextCursor!: string | null;
  hasMore!: boolean;
}

export class UnreadCountResponseDto {
  count!: number;
}

export class MarkReadResponseDto {
  updated!: number;
  /** Pushed back so a client never recomputes a badge it can be told. */
  unreadCount!: number;
}

export class PreferenceResponseDto {
  /** The event this preference is for, or `'*'` for the catch-all row. */
  type!: NotificationType | typeof PREFERENCE_WILDCARD_TYPE | null;
  /** The transport this preference governs. */
  channel!: NotificationChannel | null;
  isEnabled!: boolean;
  /** Whether matching notifications batch into a digest. */
  digest!: DigestMode | null;
  /**
   * Where the value came from.
   *
   * Lets the UI show "inherited" rather than presenting a default as a choice.
   */
  source!: PreferenceSource | null;
}

/**
 * One registered push device.
 *
 * **No token.** It is a 150+ character credential, and a settings screen needs
 * an id to delete by and a name to show — putting the secret on the wire would
 * spread it to every client that lists devices, for no reader.
 */
export class DeviceTokenResponseDto {
  readonly id!: string;
  /**
   * `IOS` | `ANDROID` | `WEB` or `null` if the platform is not recognized.
   */
  readonly platform!: DevicePlatform | null;
  readonly deviceName!: string | null;
  /** Null until the first successful push — how stale this device is. */
  readonly lastUsedAt!: Date | null;
  readonly createdAt!: Date | null;
}
