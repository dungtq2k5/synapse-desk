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
  /** The ORIGINATING event — `ticket.assigned`, never the NATS subject. */
  type!: string;
  priority!: string;
  title!: string;
  body!: string | null;
  data!: Record<string, unknown>;
  actionUrl!: string | null;
  actorId!: string | null;
  resourceType!: string | null;
  resourceId!: string | null;
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
  type!: string;
  channel!: string;
  isEnabled!: boolean;
  digest!: string;
  /**
   * `explicit` | `wildcard` | `default`.
   *
   * What lets the UI show "inherited" rather than pretending every value was
   * chosen — a settings screen that renders a default as a choice is one the
   * user cannot reason about.
   */
  source!: string;
}
