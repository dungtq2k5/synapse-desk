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
import { NotificationsGrpcClient } from './notifications-grpc.client';
import { NotificationResponseGqlDto } from './dto/graphql/notification-response.gql-dto';
import {
  NotificationFeedGqlDto,
  MarkNotificationReadPayloadGqlDto,
} from './dto/graphql/notification-feed.gql-dto';
import { UserSummaryGqlDto } from '../users/dto/graphql/user-summary.gql-dto';
import { MAX_PAGE_SIZE } from '../../common/config/graphql-limits.config';
import type { GqlContext } from '../../common/graphql/loaders/loaders.factory';
import { toUserSummaryGqlDto } from '../users/user.mapper';

/**
 * The notification feed — 26-doc §3, §4, and one mutation (25-doc §7).
 *
 * **No permission gate anywhere here.** A notification belongs to its recipient
 * and the service scopes every read to `context.sub`; a permission would be
 * asking whether someone may read their own inbox.
 */
@Resolver(() => NotificationResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class NotificationsResolver {
  constructor(private readonly notifications: NotificationsGrpcClient) {}

  @Query(() => NotificationFeedGqlDto, {
    name: 'notifications',
    description: "The caller's own notification feed, newest first.",
  })
  async feed(
    @CurrentUser() context: RequestContext,
    @Args('first', { type: () => Int, defaultValue: 20 }) first: number,
    @Args('cursor', { type: () => String, nullable: true }) cursor?: string,
  ): Promise<NotificationFeedGqlDto> {
    return await this.notifications.list(
      {
        // Clamped, like every other list — 25-doc §5.
        limit: Math.min(first, MAX_PAGE_SIZE),
        cursor,
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
  @ResolveField(() => UserSummaryGqlDto, {
    nullable: true,
    description: 'Who caused this notification. Null for a system event.',
  })
  async actor(
    @Parent() notification: NotificationResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<UserSummaryGqlDto | null> {
    if (!notification.actorId) return null;

    return toUserSummaryGqlDto(await loaders.users.load(notification.actorId));
  }

  /**
   * **One of the four mutations 25-doc §7 names**, and it earns its place: a
   * screen that renders the feed marks rows read from the same component, so
   * sharing a request with the query it updates is the whole point.
   */
  @Mutation(() => MarkNotificationReadPayloadGqlDto, {
    description:
      'Marks one notification read. Idempotent — re-reading an already-read ' +
      'row succeeds and changes nothing.',
  })
  async markNotificationRead(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() context: RequestContext,
  ): Promise<MarkNotificationReadPayloadGqlDto> {
    const { unreadCount } = await this.notifications.markRead(id, context);

    // The new BADGE, not the row. The client is rendering the list it just
    // clicked, so it already has the row; what it cannot compute is the total,
    // and a locally-decremented counter is always wrong eventually because a
    // notification can be read on another device.
    return { id, unreadCount };
  }
}
