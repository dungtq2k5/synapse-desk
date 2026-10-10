import {
  Args,
  Context,
  ID,
  Int,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import type { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import {
  NotificationResponseGqlDto,
  NotificationFeedResponseGqlDto,
  MarkNotificationReadPayloadResponseGqlDto,
} from './dto/graphql/notification-response.gql-dto';
import { UserSummaryResponseGqlDto } from '../users/dto/graphql/user-response.gql-dto';
import { MAX_PAGE_SIZE } from '../../common/config/graphql-limits.config';
import type { GqlContext } from '../../common/graphql/loaders/loaders.factory';

/**
 * The notification feed, and one mutation.
 *
 * **No permission gate anywhere here.** A notification belongs to its recipient
 * and the service scopes every read to `context.sub`; a permission would be
 * asking whether someone may read their own inbox.
 */
@Resolver(() => NotificationResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class NotificationsResolver {
  constructor(private readonly notifications: NotificationsService) {}

  @Query(() => NotificationFeedResponseGqlDto, {
    name: 'notifications',
    description: "The caller's own notification feed, newest first.",
  })
  async feed(
    @CurrentUser() context: RequestContext,
    @Args('first', { type: () => Int, defaultValue: 20 }) first: number,
    @Args('cursor', { type: () => String, nullable: true }) cursor?: string,
  ): Promise<NotificationFeedResponseGqlDto> {
    return await this.notifications.list(
      {
        // Clamped, like every other list.
        limit: Math.min(first, MAX_PAGE_SIZE),
        cursor,

        // The GraphQL feed is the unfiltered one; the REST route is where those
        // two filters are offered. Stated rather than defaulted so adding a
        // filter to the DTO cannot silently change what this query returns.
        unreadOnly: false,
        includeArchived: false,
      },
      context,
    );
  }

  @Query(() => Int, {
    description:
      'How many unread notifications the caller has. A number, not a list — ' +
      'counting by fetching is the thing this exists to avoid.',
  })
  async unreadNotificationCount(
    @CurrentUser() context: RequestContext,
  ): Promise<number> {
    const { count } = await this.notifications.unreadCount(context);

    return count;
  }

  /**
   * `Notification.actor` — who caused it.
   *
   * `UserSummary`, like every other user edge: a notification is reachable by
   * its recipient with no permission at all, so it must not become a way to
   * read an agent's contact details.
   */
  @ResolveField(() => UserSummaryResponseGqlDto, {
    nullable: true,
    description: 'Who caused this notification. Null for a system event.',
  })
  async actor(
    @Parent() notification: NotificationResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<UserSummaryResponseGqlDto | null> {
    if (!notification.actorId) return null;

    return await loaders.users.load(notification.actorId);
  }

  /**
   * **One of the four mutations on the schema**, and it earns its place: a
   * screen that renders the feed marks rows read from the same component, so
   * sharing a request with the query it updates is the whole point.
   */
  @Mutation(() => MarkNotificationReadPayloadResponseGqlDto, {
    description:
      'Marks one notification read. Idempotent — re-reading an already-read ' +
      'row succeeds and changes nothing.',
  })
  async markNotificationRead(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() context: RequestContext,
  ): Promise<MarkNotificationReadPayloadResponseGqlDto> {
    const { unreadCount } = await this.notifications.markRead(id, context);

    // The new BADGE, not the row. The client is rendering the list it just
    // clicked, so it already has the row; what it cannot compute is the total,
    // and a locally-decremented counter is always wrong eventually because a
    // notification can be read on another device.
    return { id, unreadCount };
  }
}
