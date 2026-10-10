import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  NOTIFICATION_TYPES,
  NotificationChannel,
  NotificationPriority,
  NotificationResourceType,
  PreferenceSource,
} from '@synapsedesk/common';
import {
  DigestMode as ProtoDigestMode,
  NotificationChannel as ProtoNotificationChannel,
  NotificationPriority as ProtoNotificationPriority,
  NotificationResourceType as ProtoNotificationResourceType,
  NotificationType as ProtoNotificationType,
  PreferenceSource as ProtoPreferenceSource,
} from '@synapsedesk/grpc-proto';
import {
  API,
  E2eFixture,
  anonymousAgent,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { grpcError, timestamp } from '../fixtures/wire';

/**
 * Domain E's feed at the HTTP boundary — `api-endpoints-plan.md §4b`.
 *
 * notification-service is stubbed: cursor pagination, group collapse and the
 * three notification rules all have their own suite against a real database.
 * What is under test here is what only exists at this layer — **that every
 * route is self-scoped with no way to name another user**, the route ordering
 * that `unread-count` and `preferences` would otherwise lose to `:id`, and the
 * deliberate ABSENCE of a create endpoint.
 */
describe('B Notifications at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const notificationId = faker.string.uuid();
  const ticketId = faker.string.uuid();

  const wireNotification = (overrides: Record<string, unknown> = {}) => ({
    id: notificationId,
    organizationId: faker.string.uuid(),
    type: ProtoNotificationType.NOTIFICATION_TYPE_TICKET_ASSIGNED,
    // The WIRE value. The REST assertions read domain strings, so the gap
    // between the two is the mapping under test.
    priority: ProtoNotificationPriority.NOTIFICATION_PRIORITY_NORMAL,
    title: 'Ticket #1042 assigned to you',
    body: 'You are now the assignee.',
    // A JSON STRING on the wire — proto3 has no `map<string, any>`.
    data: JSON.stringify({ ticketId, ticketNumber: 1042 }),
    actionUrl: '/tickets/1042',
    actorId: faker.string.uuid(),
    resourceType:
      ProtoNotificationResourceType.NOTIFICATION_RESOURCE_TYPE_TICKET,
    resourceId: ticketId,
    groupKey: undefined,
    groupCount: 1,
    readAt: undefined,
    archivedAt: undefined,
    createdAt: timestamp(),
    ...overrides,
  });

  const stubFeed = (
    items: ReturnType<typeof wireNotification>[],
    extra: Record<string, unknown> = {},
  ) =>
    fx.stubs.notification.listNotifications.mockReturnValue(
      of({ items, nextCursor: undefined, hasMore: false, ...extra }),
    );

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await fx.close();
  });

  describe('the feed', () => {
    it('1. Returns the caller’s feed with `data` PARSED back into an object', async () => {
      // The client should never see the encoding the transport needed.
      stubFeed([wireNotification()]);

      const res = await authenticatedAgent(fx.app).get(`${API}/notifications`);

      expect(res.status).toBe(200);
      expect(res.body.data.items[0].data).toEqual({
        ticketId,
        ticketNumber: 1042,
      });
      expect(res.body.data.items[0].actionUrl).toBe('/tickets/1042');
      // `priority` crosses as a numeric enum and must reach the client as its
      // NAME. Nothing asserted this while the field was a bare string, because
      // the stub and the assertion were the same value and the gateway merely
      // forwarded it — so the mapping had nothing holding it in place.
      expect(res.body.data.items[0].priority).toBe(NotificationPriority.NORMAL);
    });

    it('2. Survives a MALFORMED `data` payload rather than failing the feed', async () => {
      // One bad row must not take out every notification the user has.
      stubFeed([wireNotification({ data: 'not json' })]);

      const res = await authenticatedAgent(fx.app).get(`${API}/notifications`);

      expect(res.status).toBe(200);
      expect(res.body.data.items[0].data).toEqual({});
    });

    it('3. Carries the CURSOR envelope, not a page envelope', async () => {
      // `page`/`totalPages` are questions a cursor feed cannot answer honestly:
      // there is no page number, and a total that changes between two requests
      // is a number the client would render as though it were stable.
      stubFeed([wireNotification()], { nextCursor: 'abc', hasMore: true });

      const res = await authenticatedAgent(fx.app).get(`${API}/notifications`);

      expect(res.body.data).toMatchObject({ nextCursor: 'abc', hasMore: true });
      expect(res.body.data).not.toHaveProperty('meta');
    });

    it('4. Forwards `nextCursor` as null on the last page', async () => {
      // `?? null` rather than leaving it undefined: a client checking
      // `nextCursor !== null` would loop forever on undefined.
      stubFeed([]);

      const res = await authenticatedAgent(fx.app).get(`${API}/notifications`);

      expect(res.body.data.nextCursor).toBeNull();
    });

    it('5. Passes the filters through as typed values', async () => {
      stubFeed([]);

      await authenticatedAgent(fx.app).get(
        `${API}/notifications?unreadOnly=true&type=${NOTIFICATION_TYPES.quotaThreshold}&limit=5`,
      );

      expect(fx.stubs.notification.listNotifications).toHaveBeenCalledWith(
        expect.objectContaining({
          unreadOnly: true,
          // The REST query names the domain value; the WIRE carries the proto
          // enum. That gap is the mapping this test exists to pin.
          type: ProtoNotificationType.NOTIFICATION_TYPE_QUOTA_THRESHOLD,
          limit: 5,
        }),
        expect.anything(),
      );
    });

    it('6. Rejects an unknown `type` with 400, without calling the service', async () => {
      const res = await authenticatedAgent(fx.app).get(
        `${API}/notifications?type=ticket.assinged`,
      );

      expect(res.status).toBe(400);
      expect(fx.stubs.notification.listNotifications).not.toHaveBeenCalled();
    });

    it('7. Caps `limit`, because it arrives from a client', async () => {
      const res = await authenticatedAgent(fx.app).get(
        `${API}/notifications?limit=10000`,
      );

      expect(res.status).toBe(400);
    });

    it('8. Requires authentication — the feed has no anonymous form', async () => {
      const res = await anonymousAgent(fx.app).get(`${API}/notifications`);

      expect(res.status).toBe(401);
    });

    it('9. Sends NO user id — the recipient is the CALLER, from metadata', async () => {
      // The structural version of "self-scoped": there is no request field a
      // caller could set to read someone else's inbox, so it cannot be done by
      // forging one.
      stubFeed([]);

      await authenticatedAgent(fx.app).get(`${API}/notifications`);

      const [request] = fx.stubs.notification.listNotifications.mock.calls[0];

      expect(Object.keys(request)).not.toContain('recipientId');
      expect(Object.keys(request)).not.toContain('userId');
    });
  });

  describe('route ordering', () => {
    it('10. `unread-count` is not swallowed by `:id`', async () => {
      // `:id` would match `unread-count` and `ParseUUIDPipe` would turn it into
      // a 400 that reads as a client bug rather than a routing mistake — the
      // same hazard `documents/storage` and `bulk/status` each hit.
      fx.stubs.notification.getUnreadCount.mockReturnValue(of({ count: 7 }));

      const res = await authenticatedAgent(fx.app).get(
        `${API}/notifications/unread-count`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(7);
    });

    it('11. `preferences` is not swallowed by `:id`', async () => {
      fx.stubs.notification.listPreferences.mockReturnValue(of({ items: [] }));

      const res = await authenticatedAgent(fx.app).get(
        `${API}/notifications/preferences`,
      );

      expect(res.status).toBe(200);
    });

    it('12. `POST /notifications/read` is not swallowed by `:id/read`', async () => {
      fx.stubs.notification.markManyRead.mockReturnValue(
        of({ updated: 12, unreadCount: 0 }),
      );

      const res = await authenticatedAgent(fx.app)
        .post(`${API}/notifications/read`)
        .send({
          resourceType: NotificationResourceType.TICKET,
          resourceId: ticketId,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBe(12);
      expect(fx.stubs.notification.markRead).not.toHaveBeenCalled();
    });
  });

  describe('read and archive', () => {
    it('13. Marking read is 200, not 201 — nothing was created', async () => {
      fx.stubs.notification.markRead.mockReturnValue(
        of({ updated: 1, unreadCount: 3 }),
      );

      const res = await authenticatedAgent(fx.app).post(
        `${API}/notifications/${notificationId}/read`,
      );

      expect(res.status).toBe(200);
      // The badge, pushed back so a client never recomputes it.
      expect(res.body.data.unreadCount).toBe(3);
    });

    it('14. A NOT_FOUND from the service becomes a 404, not a 403', async () => {
      // A 403 would confirm the id exists, turning this route into an oracle
      // for other users' inboxes.
      fx.stubs.notification.markRead.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.NOT_FOUND, 'No notification with that id'),
        ),
      );

      const res = await authenticatedAgent(fx.app).post(
        `${API}/notifications/${notificationId}/read`,
      );

      expect(res.status).toBe(404);
    });

    it('15. Rejects a non-uuid id before dialling the service', async () => {
      const res = await authenticatedAgent(fx.app).post(
        `${API}/notifications/not-a-uuid/read`,
      );

      expect(res.status).toBe(400);
      expect(fx.stubs.notification.markRead).not.toHaveBeenCalled();
    });

    it('16. Bulk read caps how many ids one call may carry', async () => {
      const res = await authenticatedAgent(fx.app)
        .post(`${API}/notifications/read`)
        .send({ ids: Array.from({ length: 500 }, () => faker.string.uuid()) });

      expect(res.status).toBe(400);
    });
  });

  describe('preferences', () => {
    it('17. Returns the resolved catalogue with its SOURCE', async () => {
      // `source` is what lets the UI show "inherited" rather than pretending
      // every value was chosen.
      fx.stubs.notification.listPreferences.mockReturnValue(
        of({
          items: [
            {
              type: '*',
              // Proto enums: this stub stands in for the WIRE, and the REST
              // assertion below is a domain string. The gap between them is
              // the mapping under test — a stub written in domain strings
              // would prove the gateway forwards, not that it converts.
              channel: ProtoNotificationChannel.NOTIFICATION_CHANNEL_EMAIL,
              isEnabled: true,
              digest: ProtoDigestMode.DIGEST_MODE_IMMEDIATE,
              source: ProtoPreferenceSource.PREFERENCE_SOURCE_DEFAULT,
            },
          ],
        }),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/notifications/preferences`,
      );

      expect(res.body.data[0].source).toBe(PreferenceSource.DEFAULT);
    });

    it('18. Upserts a preference', async () => {
      fx.stubs.notification.updatePreference.mockReturnValue(
        of({
          type: NOTIFICATION_TYPES.ticketAssigned,
          channel: ProtoNotificationChannel.NOTIFICATION_CHANNEL_EMAIL,
          isEnabled: false,
          digest: ProtoDigestMode.DIGEST_MODE_IMMEDIATE,
          source: ProtoPreferenceSource.PREFERENCE_SOURCE_EXPLICIT,
        }),
      );

      const res = await authenticatedAgent(fx.app)
        .patch(`${API}/notifications/preferences`)
        .send({
          type: NOTIFICATION_TYPES.ticketAssigned,
          channel: NotificationChannel.EMAIL,
          isEnabled: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.source).toBe(PreferenceSource.EXPLICIT);
    });

    it('19. Rejects the WEBHOOK channel at the boundary', async () => {
      // In the enum for completeness and deliberately unimplemented — a
      // preference for it would be a switch wired to nothing.
      const res = await authenticatedAgent(fx.app)
        .patch(`${API}/notifications/preferences`)
        .send({
          type: '*',
          channel: NotificationChannel.WEBHOOK,
          isEnabled: false,
        });

      expect(res.status).toBe(400);
      expect(fx.stubs.notification.updatePreference).not.toHaveBeenCalled();
    });

    it('20. Rejects an unknown type at the boundary', async () => {
      const res = await authenticatedAgent(fx.app)
        .patch(`${API}/notifications/preferences`)
        .send({
          type: 'ticket.assinged',
          channel: NotificationChannel.EMAIL,
          isEnabled: false,
        });

      expect(res.status).toBe(400);
    });
  });

  describe('what does NOT exist', () => {
    it('21. **There is no `POST /notifications`**', async () => {
      // An HTTP create endpoint would be a spam vector into other users'
      // inboxes and would bypass the `event_id` idempotency that makes NATS
      // at-least-once delivery safe. Notifications are written by consumers,
      // never by a client.
      const res = await authenticatedAgent(fx.app)
        .post(`${API}/notifications`)
        .send({ title: 'Injected', recipientId: faker.string.uuid() });

      expect(res.status).toBe(404);
    });

    it('22. There is no DELETE — archive is the dismissal', async () => {
      // `expires_at` and the pruning job own deletion. A user who archives
      // something must still be able to find it with the flag.
      const res = await authenticatedAgent(fx.app).delete(
        `${API}/notifications/${notificationId}`,
      );

      expect(res.status).toBe(404);
    });

    it('23. There is no delivery-state route', async () => {
      // Delivery state is operational telemetry: a user seeing `BOUNCED` on
      // their own address cannot act on it, and `provider_message_id` leaks the
      // ESP relationship.
      const res = await authenticatedAgent(fx.app).get(
        `${API}/notifications/${notificationId}/deliveries`,
      );

      expect(res.status).toBe(404);
    });
  });
});
