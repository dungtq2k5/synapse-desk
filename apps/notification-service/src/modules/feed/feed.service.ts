import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  CallerContext,
  NotificationReadPayload,
  requireActor,
} from '@synapsedesk/common';
import {
  ListNotificationsRequest,
  ListNotificationsResponse,
  MarkReadRequest,
  MarkReadResponse,
  NotificationIdRequest,
} from '@synapsedesk/grpc-proto';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationRealtimePublisher } from '../realtime/notification-realtime.publisher';
import { cursorPredicate, decodeCursor, encodeCursor } from './feed.cursor';
import { toNotificationResponse } from './feed.mapper';

/** api-endpoints-plan §4b: 20 a page. */
const DEFAULT_PAGE_SIZE = 20;

/**
 * A ceiling, because the limit arrives from a client.
 *
 * Not a paranoid one: the feed is ordered by `created_at DESC` over a partial
 * index, and a request for 10,000 rows is a query that succeeds slowly and
 * serializes a response nobody renders.
 */
const MAX_PAGE_SIZE = 100;

/**
 * The personal inbox.
 *
 * **Every method is SELF-scoped**, filtered by `recipientId = ctx.sub` and
 * never by a request field. There is no admin read-someone-else's-inbox path
 * and there should not be one: the feed is a personal inbox, and anything a
 * supervisor legitimately needs is in `audit_logs`.
 *
 * The scoping is applied at the START of each method rather than trusted to a
 * guard, because the guard would live at the gateway and this service is also
 * reachable from inside the mesh.
 */
@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: NotificationRealtimePublisher,
  ) {}

  async list(
    request: ListNotificationsRequest,
    context: CallerContext,
  ): Promise<ListNotificationsResponse> {
    const recipientId = requireActor(context);
    const take = clampLimit(request.limit);
    const cursor = decodeCursor(request.cursor);

    const rows = await this.prisma.notification.findMany({
      where: {
        ...this.baseFilter(recipientId, request),
        ...(cursor ? cursorPredicate(cursor) : {}),
      },
      // The tie-break must be in the ORDER BY as well as in the predicate.
      // Ordering by `created_at` alone lets Postgres return rows sharing a
      // timestamp in any order it likes, and then the cursor's `id < …` clause
      // drops whichever ones it decided to put first.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One extra, so "is there more?" is answered without a second COUNT over
      // the same predicate — and a count would be wrong the moment a row
      // arrived between the two queries anyway.
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const last = items.at(-1);

    return {
      items: items.map(toNotificationResponse),
      // Absent on the last page, so a client stops rather than polling a
      // cursor that returns nothing forever.
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : undefined,
      hasMore,
    };
  }

  /**
   * The badge, and it is polled far more often than the feed is read.
   *
   * A `count` over the partial index `(recipient_id) WHERE read_at IS NULL AND
   * archived_at IS NULL` — which is why that index exists and why the seeder
   * applies it. Without it this degrades into a scan of every notification the
   * user has ever received, and nothing surfaces that except latency.
   */
  async unreadCount(context: CallerContext): Promise<number> {
    const recipientId = requireActor(context);

    return this.prisma.notification.count({
      where: { recipientId, readAt: null, archivedAt: null },
    });
  }

  /**
   * Mark one read. **Idempotent — a double-click is a 200, not a 409.**
   *
   * `updateMany` rather than `update`, and the difference is the security
   * property: `update` with a bare id would touch another user's row, so the
   * recipient has to be in the WHERE clause rather than checked afterwards.
   * A row that does not match produces `count: 0`, which becomes the 404 below.
   */
  async markRead(
    request: NotificationIdRequest,
    context: CallerContext,
  ): Promise<MarkReadResponse> {
    return this.applyState(request.id, context, 'read');
  }

  /**
   * Dismiss. **Hidden from the feed, not deleted** — `expires_at` and the
   * pruning job own deletion, and a user who archives something must still be
   * able to find it with the flag.
   */
  async archive(
    request: NotificationIdRequest,
    context: CallerContext,
  ): Promise<MarkReadResponse> {
    return this.applyState(request.id, context, 'archived');
  }

  /**
   * Bulk read, by ids or by RESOURCE.
   *
   * The resource form is what makes this feature usable rather than annoying:
   * opening ticket #1042 clears all twelve of its notifications in one call
   * instead of leaving the user to dismiss them one at a time, which is the
   * behaviour that trains people to ignore the badge entirely.
   */
  async markManyRead(
    request: MarkReadRequest,
    context: CallerContext,
  ): Promise<MarkReadResponse> {
    const recipientId = requireActor(context);
    const ids = request.ids ?? [];
    const byResource = Boolean(request.resourceType && request.resourceId);

    if (ids.length === 0 && !byResource) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Provide either ids or a resourceType and resourceId',
      });
    }

    const where: Prisma.NotificationWhereInput = {
      recipientId,
      readAt: null,
      ...(ids.length > 0 ? { id: { in: ids } } : {}),
      ...(byResource
        ? {
            resourceType: request.resourceType,
            resourceId: request.resourceId,
          }
        : {}),
    };

    // The ids BEFORE the update, so the realtime payload can name them. After
    // the update they no longer match `readAt: null` and the query returns
    // nothing — the mistake that makes a second tab update silently do nothing.
    const affected = await this.prisma.notification.findMany({
      where,
      select: { id: true },
    });

    const { count } = await this.prisma.notification.updateMany({
      where,
      data: { readAt: new Date() },
    });

    return this.respond(
      recipientId,
      count,
      affected.map((row) => row.id),
      'read',
    );
  }

  private async applyState(
    id: string,
    context: CallerContext,
    change: 'read' | 'archived',
  ): Promise<MarkReadResponse> {
    const recipientId = requireActor(context);

    const { count } = await this.prisma.notification.updateMany({
      where: { id, recipientId },
      data:
        change === 'read'
          ? { readAt: new Date() }
          : // Archiving implies read. A dismissed notification that still
            // counted toward the badge would leave a number the user cannot
            // clear without opening something they deliberately dismissed.
            { archivedAt: new Date(), readAt: new Date() },
    });

    if (count === 0) {
      // **404, not 403**. A 403 confirms the id exists,
      // which turns this endpoint into an oracle for other users' inboxes.
      // Same rule as everywhere else in the system.
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No notification with that id',
      });
    }

    return this.respond(recipientId, count, [id], change);
  }

  private async respond(
    recipientId: string,
    updated: number,
    notificationIds: string[],
    change: 'read' | 'archived',
  ): Promise<MarkReadResponse> {
    const unreadCount = await this.prisma.notification.count({
      where: { recipientId, readAt: null, archivedAt: null },
    });

    if (updated > 0) {
      // So a second tab stops showing a badge the user cleared. `read_at` is
      // per-row rather than per-connection, so without this two open tabs
      // disagree until one of them refreshes.
      const payload: NotificationReadPayload = {
        recipientId,
        notificationIds,
        change,
        unreadCount,
      };
      this.realtime.publishRead(payload);
    }

    return { updated, unreadCount };
  }

  private baseFilter(
    recipientId: string,
    request: ListNotificationsRequest,
  ): Prisma.NotificationWhereInput {
    return {
      recipientId,
      ...(request.type ? { type: request.type } : {}),
      ...(request.unreadOnly ? { readAt: null } : {}),
      // Archived rows are excluded BY DEFAULT and included with the flag —
      // the feed is a worklist, and a dismissed notification reappearing in it
      // is the reason people stop dismissing things.
      ...(request.includeArchived ? {} : { archivedAt: null }),
    };
  }
}

/** Bounded, and defaulted when a client sends 0 — proto3 has no "absent" int. */
function clampLimit(limit: number | undefined): number {
  if (!limit || limit <= 0) return DEFAULT_PAGE_SIZE;

  return Math.min(limit, MAX_PAGE_SIZE);
}

export { type NotificationResponse } from '@synapsedesk/grpc-proto';
