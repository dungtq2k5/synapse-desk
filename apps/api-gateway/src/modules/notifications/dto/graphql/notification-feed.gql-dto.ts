import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { NotificationResponseGqlDto } from './notification-response.gql-dto';

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
export class NotificationFeedGqlDto {
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
export class MarkNotificationReadPayloadGqlDto {
  @Field(() => ID)
  id!: string;

  /** The authoritative total, so the badge does not have to be decremented
   * locally — which is always wrong eventually, because a notification can be
   * read on another device. */
  @Field(() => Int)
  unreadCount!: number;
}
