import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  NotificationPriority,
  NotificationResourceType,
  NotificationType,
} from '@synapsedesk/common';

/**
 * One row of the in-app feed, as the GraphQL schema serves it.
 *
 * **`data`, `groupKey` and `groupCount` are absent**, recorded as REST-only in
 * the contract spec:
 *
 *   - `data` is an untyped bag whose shape varies by notification type. GraphQL
 *     has no honest type for it short of a JSON scalar, and a JSON scalar in a
 *     schema is a hole where the contract should be.
 *   - `groupKey` is Domain E's internal coalescing key and means nothing to a
 *     client.
 */
@ObjectType('Notification')
export class NotificationResponseGqlDto {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  organizationId!: string;

  /**
   * The ORIGINATING event — `ticket.assigned`, never the NATS subject.
   *
   * Nullable because the REST DTO is: a value this build cannot name answers
   * `null`, and a non-null field receiving one fails the WHOLE query.
   */
  @Field(() => String, { nullable: true })
  type!: NotificationType | null;

  /** How urgent it is. Nullable for the same reason as {@link type}. */
  @Field(() => String, { nullable: true })
  priority!: NotificationPriority | null;

  @Field(() => String)
  title!: string;

  @Field(() => String, { nullable: true })
  body!: string | null;

  @Field(() => String, { nullable: true })
  actionUrl!: string | null;

  /** Who caused it. Flat beside the `actor` edge — same rule as everywhere. */
  @Field(() => ID, { nullable: true })
  actorId!: string | null;

  @Field(() => String, { nullable: true })
  resourceType!: NotificationResourceType | null;

  @Field(() => ID, { nullable: true })
  resourceId!: string | null;

  @Field(() => Date, { nullable: true })
  readAt!: Date | null;

  @Field(() => Date, { nullable: true })
  archivedAt!: Date | null;

  @Field(() => Date)
  createdAt!: Date;
}

/**
 * The notification feed — CURSOR-paginated, unlike every other list.
 *
 * Not an inconsistency to tidy up: the feed is an append-only stream a client
 * scrolls, and offset pagination over a list that grows at the head skips rows
 * and repeats others. The REST route already uses a cursor, and the schema
 * describes what the service does rather than what the other lists happen to.
 *
 * That is also why there is no `PageMeta` here: it carries `page`, `totalPages`
 * and `totalItems`, none of which a cursor feed can answer honestly.
 */
@ObjectType('NotificationFeed')
export class NotificationFeedResponseGqlDto {
  @Field(() => [NotificationResponseGqlDto])
  items!: NotificationResponseGqlDto[];

  /** Null on the last page — a client that keeps polling gets nothing forever. */
  @Field(() => String, { nullable: true })
  nextCursor!: string | null;

  @Field(() => Boolean)
  hasMore!: boolean;
}

/**
 * Marking a notification read.
 *
 * Deliberately NOT the notification row: the client already has it — it is
 * rendering the list the user just clicked — and what it cannot compute is the
 * new unread badge. Returning the row would mean re-reading a page of the feed
 * to find one entry.
 */
@ObjectType('MarkNotificationReadPayload')
export class MarkNotificationReadPayloadResponseGqlDto {
  @Field(() => ID)
  id!: string;

  /** The authoritative total, so the badge does not have to be decremented
   * locally — which is always wrong eventually, because a notification can be
   * read on another device. */
  @Field(() => Int)
  unreadCount!: number;
}
