import { status } from '@grpc/grpc-js';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import {
  callerContext,
  memberContext,
} from '@synapsedesk/common/testing/context';
import {
  NOTIFICATION_REALTIME_PATTERNS,
  NOTIFICATION_TYPES,
  NotificationResourceType,
} from '@synapsedesk/common';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { FeedService } from '../../src/modules/feed/feed.service';

/**
 * The personal inbox.
 *
 * The two properties worth the most here are the ones a reader cannot check by
 * eye: that **cursor pagination does not shift rows under the reader**, and
 * that **every route is self-scoped**. Both fail silently — a duplicated page
 * looks like a UI bug, and a leak looks like nothing at all.
 */
describe('The notification feed (e2e)', () => {
  let fx: E2eFixture;
  let feed: FeedService;

  const ORG = '11111111-1111-4111-8111-111111111111';
  const ME = '22222222-2222-4222-8222-222222222222';
  const COLLEAGUE = '33333333-3333-4333-8333-333333333333';
  const OTHER_TENANT_USER = '44444444-4444-4444-8444-444444444444';

  const TICKET_ID = '55555555-5555-4555-8555-555555555555';

  const me = () => memberContext({ id: ME, organizationId: ORG });
  const colleague = () => memberContext({ id: COLLEAGUE, organizationId: ORG });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    feed = fx.moduleRef.get(FeedService);
  });

  beforeEach(async () => {
    await fx.reset();
  });

  afterAll(async () => {
    await fx.close();
  });

  /**
   * Rows with DISTINCT, DESCENDING timestamps.
   *
   * Written explicitly rather than left to `now()`: several inserts inside one
   * millisecond would make the ordering depend on the id tie-break, and a
   * pagination test whose page boundaries move is one that fails for reasons
   * unrelated to what it is checking.
   */
  async function seed(
    count: number,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    const base = Date.parse('2026-08-06T12:00:00.000Z');

    for (let index = 0; index < count; index += 1) {
      await fx.prisma.notification.create({
        data: {
          organizationId: ORG,
          recipientId: ME,
          type: NOTIFICATION_TYPES.ticketAssigned,
          title: `Notification ${index}`,
          createdAt: new Date(base + index * 1_000),
          ...overrides,
        },
      });
    }
  }

  const listRequest = (overrides = {}) => ({
    unreadOnly: false,
    includeArchived: false,
    limit: 20,
    ...overrides,
  });

  describe('scoping', () => {
    it('1. Returns only the CALLER’s rows — another user in the same tenant', async () => {
      // The same-tenant case is the one a naive `organizationId` filter passes.
      // The feed is a personal inbox: tenant scoping is not enough.
      await seed(2);
      await fx.prisma.notification.create({
        data: {
          organizationId: ORG,
          recipientId: COLLEAGUE,
          type: NOTIFICATION_TYPES.ticketAssigned,
          title: 'Not yours',
        },
      });

      const { items } = await feed.list(listRequest(), me());

      expect(items).toHaveLength(2);
      expect(items.every((item) => item.title !== 'Not yours')).toBe(true);
    });

    it('2. Returns nothing to a caller from another tenant', async () => {
      await seed(3);

      const { items } = await feed.list(
        listRequest(),
        memberContext({
          id: OTHER_TENANT_USER,
          organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        }),
      );

      expect(items).toEqual([]);
    });

    it('3. Refuses an unauthenticated caller rather than serving an empty feed', async () => {
      // `sub: null` is exactly what `unpackCallerContext` produces when the
      // metadata key is absent — i.e. a route missing `JwtAuthGuard`. An empty
      // feed there reads as "you have no notifications", which is a lie a
      // client renders rather than retries.
      await expectRpc(
        feed.list(listRequest(), callerContext({ sub: null })),
        status.UNAUTHENTICATED,
      );
    });
  });

  describe('filters', () => {
    it('4. Excludes ARCHIVED rows by default and includes them with the flag', async () => {
      await seed(2);
      await seed(1, { archivedAt: new Date(), title: 'Dismissed' });

      const byDefault = await feed.list(listRequest(), me());
      const withFlag = await feed.list(
        listRequest({ includeArchived: true }),
        me(),
      );

      expect(byDefault.items).toHaveLength(2);
      expect(withFlag.items).toHaveLength(3);
    });

    it('5. Filters by TYPE, which is only possible because type is the originating event', async () => {
      // The bug in practice: with `type` written as the transport subject, every
      // row would match every filter and this test could not exist.
      await seed(2);
      await seed(1, { type: NOTIFICATION_TYPES.quotaThreshold });

      const { items } = await feed.list(
        listRequest({ type: NOTIFICATION_TYPES.quotaThreshold }),
        me(),
      );

      expect(items).toHaveLength(1);
    });

    it('6. `unreadOnly` hides rows that have been read', async () => {
      await seed(2);
      await seed(1, { readAt: new Date(), title: 'Already read' });

      const { items } = await feed.list(
        listRequest({ unreadOnly: true }),
        me(),
      );

      expect(items).toHaveLength(2);
    });
  });

  describe('cursor pagination', () => {
    it('7. Pages through every row exactly once', async () => {
      await seed(5);

      const first = await feed.list(listRequest({ limit: 2 }), me());
      const second = await feed.list(
        listRequest({ limit: 2, cursor: first.nextCursor }),
        me(),
      );
      const third = await feed.list(
        listRequest({ limit: 2, cursor: second.nextCursor }),
        me(),
      );

      const ids = [...first.items, ...second.items, ...third.items].map(
        (item) => item.id,
      );

      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
      expect(third.hasMore).toBe(false);
      expect(third.nextCursor).toBeUndefined();
    });

    it('8. **A row inserted between page 1 and page 2 does not shift page 2**', async () => {
      // The reason for cursors, made mechanical.
      //
      // With `OFFSET`, an arrival at the head pushes every row down one, so
      // page 2 re-serves a row the client already has. Nothing in the response
      // says so: the client renders a duplicate, or on a delete skips a row
      // nobody ever sees.
      await seed(4);

      const first = await feed.list(listRequest({ limit: 2 }), me());

      // Newest of all, so an offset-based reader would be pushed by exactly one.
      await fx.prisma.notification.create({
        data: {
          organizationId: ORG,
          recipientId: ME,
          type: NOTIFICATION_TYPES.ticketAssigned,
          title: 'Arrived mid-pagination',
          createdAt: new Date('2026-08-06T13:00:00.000Z'),
        },
      });

      const second = await feed.list(
        listRequest({ limit: 2, cursor: first.nextCursor }),
        me(),
      );

      const firstIds = first.items.map((item) => item.id);
      const secondIds = second.items.map((item) => item.id);

      // No duplicate…
      expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
      // …and no skip: the two pages are the four rows that existed at the
      // start, in order.
      expect([...firstIds, ...secondIds]).toHaveLength(4);
      expect(
        second.items.every((item) => item.title !== 'Arrived mid-pagination'),
      ).toBe(true);
    });

    it('9. Rows sharing a TIMESTAMP are still paged exactly once', async () => {
      // The tie-break. A group collapse refreshes `created_at` to `NOW()` for a
      // whole fan-out, so ties are the normal case rather than a rarity — and a
      // cursor on a non-unique column either repeats or skips every row that
      // ties with the page boundary.
      const sameInstant = new Date('2026-08-06T12:00:00.000Z');
      for (let index = 0; index < 4; index += 1) {
        await fx.prisma.notification.create({
          data: {
            organizationId: ORG,
            recipientId: ME,
            type: NOTIFICATION_TYPES.ticketAssigned,
            title: `Tied ${index}`,
            createdAt: sameInstant,
          },
        });
      }

      const first = await feed.list(listRequest({ limit: 2 }), me());
      const second = await feed.list(
        listRequest({ limit: 2, cursor: first.nextCursor }),
        me(),
      );

      const ids = [...first.items, ...second.items].map((item) => item.id);
      expect(new Set(ids).size).toBe(4);
    });

    it('10. A MALFORMED cursor serves the first page rather than erroring', async () => {
      // Almost always a stale client or a truncated URL. Answering page one is
      // a better outcome than a 400 the user cannot act on — the one thing it
      // must not do is fall through into an unfiltered query, which tests 1 and
      // 2 cover.
      await seed(3);

      const { items } = await feed.list(
        listRequest({ cursor: 'not-a-cursor' }),
        me(),
      );

      expect(items).toHaveLength(3);
    });
  });

  describe('unread count', () => {
    it('11. Counts unread and non-archived only', async () => {
      await seed(3);
      await seed(1, { readAt: new Date() });
      await seed(1, { archivedAt: new Date() });

      await expect(feed.unreadCount(me())).resolves.toBe(3);
    });

    it('12. Uses the PARTIAL index rather than scanning', async () => {
      // Asserted via EXPLAIN, because the alternative is that badge polling
      // silently degrades into a table scan on the largest table in the system
      // and nothing surfaces it but latency.
      await seed(3);

      const plan = await fx.prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT COUNT(*) FROM notifications
           WHERE recipient_id = '${ME}'
             AND read_at IS NULL AND archived_at IS NULL`,
      );
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');

      expect(text).toContain('notifications_unread_idx');
    });
  });

  describe('read and archive', () => {
    it('13. Marking read twice is a success, not a conflict', async () => {
      // Idempotent by design: a double-click must not error, and a client
      // retrying on a flaky connection must not have to distinguish "already
      // read" from "failed".
      await seed(1);
      const [row] = await fx.prisma.notification.findMany();

      const first = await feed.markRead({ id: row.id }, me());
      const second = await feed.markRead({ id: row.id }, me());

      expect(first.updated).toBe(1);
      expect(second.updated).toBe(1);
      expect(second.unreadCount).toBe(0);
    });

    it('14. Marking ANOTHER user’s notification read is 404, not 403', async () => {
      // A 403 confirms the id exists, which turns this endpoint into an oracle
      // for other users' inboxes. Same rule as everywhere else in the system.
      await seed(1);
      const [row] = await fx.prisma.notification.findMany();

      await expectRpc(
        feed.markRead({ id: row.id }, colleague()),
        status.NOT_FOUND,
      );

      const after = await fx.prisma.notification.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.readAt).toBeNull();
    });

    it('15. Archiving implies READ, so the badge can actually be cleared', async () => {
      // A dismissed notification that still counted toward the badge would
      // leave a number the user cannot clear without opening something they
      // deliberately dismissed.
      await seed(1);
      const [row] = await fx.prisma.notification.findMany();

      await feed.archive({ id: row.id }, me());

      const after = await fx.prisma.notification.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.archivedAt).not.toBeNull();
      expect(after.readAt).not.toBeNull();
      await expect(feed.unreadCount(me())).resolves.toBe(0);
    });

    it('16. Bulk read by RESOURCE clears every notification for that ticket', async () => {
      // The behaviour that makes the feature usable rather than annoying:
      // opening ticket #1042 clears all twelve of its notifications in one
      // call, instead of leaving the user to dismiss them one at a time.
      await seed(12, {
        resourceType: NotificationResourceType.TICKET,
        resourceId: TICKET_ID,
      });
      await seed(2, { title: 'Unrelated' });

      const result = await feed.markManyRead(
        {
          ids: [],
          resourceType: NotificationResourceType.TICKET,
          resourceId: TICKET_ID,
        },
        me(),
      );

      expect(result.updated).toBe(12);
      // The unrelated two are untouched — a bulk read must not be a "mark
      // everything" in disguise.
      expect(result.unreadCount).toBe(2);
    });

    it('17. Bulk read by IDS touches only the caller’s rows', async () => {
      await seed(2);
      const mine = await fx.prisma.notification.findMany();
      const theirs = await fx.prisma.notification.create({
        data: {
          organizationId: ORG,
          recipientId: COLLEAGUE,
          type: NOTIFICATION_TYPES.ticketAssigned,
          title: 'Not yours',
        },
      });

      const result = await feed.markManyRead(
        { ids: [...mine.map((row) => row.id), theirs.id] },
        me(),
      );

      expect(result.updated).toBe(2);
      const stillUnread = await fx.prisma.notification.findUniqueOrThrow({
        where: { id: theirs.id },
      });
      expect(stillUnread.readAt).toBeNull();
    });

    it('18. Bulk read with NEITHER shape is refused rather than marking everything', async () => {
      // The failure mode is silent and total: an empty filter would read the
      // whole inbox, and the caller would see a success.
      await seed(3);

      await expectRpc(
        feed.markManyRead({ ids: [] }, me()),
        status.INVALID_ARGUMENT,
      );

      await expect(feed.unreadCount(me())).resolves.toBe(3);
    });

    it('19. Publishes `notification.read` so a second tab catches up', async () => {
      // `read_at` is per-row rather than per-connection, so without this two
      // open tabs disagree until one refreshes — and dismissing on mobile
      // leaves the desktop badge lit.
      await seed(2);
      const [row] = await fx.prisma.notification.findMany();
      fx.emitted.length = 0;

      await feed.markRead({ id: row.id }, me());

      // `find`, not a destructured `filter`: it stops at the first match and
      // TYPES the absence, so the `toBeDefined()` below is a real check
      // rather than one the element type already guaranteed.
      const event = fx.emitted.find(
        (entry) => entry.pattern === NOTIFICATION_REALTIME_PATTERNS.read,
      );

      expect(event).toBeDefined();
      const payload = event!.payload as {
        recipientId: string;
        unreadCount: number;
        change: string;
      };
      expect(payload.recipientId).toBe(ME);
      expect(payload.change).toBe('read');
      // Authoritative, so a client never increments a local counter that is
      // wrong the moment something is read on another device.
      expect(payload.unreadCount).toBe(1);
    });

    it('20. Publishes NOTHING when a bulk read matched no rows', async () => {
      await seed(1);
      const [row] = await fx.prisma.notification.findMany();
      await feed.markRead({ id: row.id }, me());
      fx.emitted.length = 0;

      await feed.markManyRead({ ids: [row.id] }, me());

      expect(fx.emitted).toHaveLength(0);
    });
  });
});
