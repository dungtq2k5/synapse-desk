import {
  DeliverySkipReason,
  DeliveryStatus,
  DigestMode,
  NOTIFICATION_REALTIME_PATTERNS,
  NOTIFICATION_TYPES,
  NotificationChannel,
  NotificationPriority,
  NotificationResourceType,
  compareAlphabetically,
  quotaThresholdEventId,
} from '@synapsedesk/common';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { InAppNotificationService } from '../../src/modules/in-app/in-app-notification.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { EmailService } from '../../src/modules/email/email.service';

const ORG = '11111111-1111-4111-8111-111111111111';

/** The permission `quota-alert.service.ts` addresses its alerts to. */
const AUDIENCE = 'organization.update';
const CYCLE_START = new Date('2026-08-01T00:00:00.000Z');

/**
 * §3, §5 — Domain E's write path.
 *
 * **Every assertion here is on something a user could SEE**: a row in their
 * feed, a captured outbound email, or a delivery record that answers *"why
 * didn't I get one?"*. That is the point of the finding this suite was born
 * from — the emit was never the failure. `quota-alert.service.ts` published
 * correctly, idempotently, to the right audience, into a subject with no
 * subscriber, and a test asserting the emit is exactly what let it reach
 * production looking finished.
 */
describe('§1 In-app notification delivery (e2e)', () => {
  let fx: E2eFixture;
  let inApp: InAppNotificationService;

  let listPermissionHolders: jest.SpyInstance;
  let listUsersByIds: jest.SpyInstance;
  let sendEmail: jest.SpyInstance;

  const ADMINS = [
    {
      userId: '22222222-2222-4222-8222-222222222222',
      email: 'admin@tenant.test',
      fullName: 'Ada Admin',
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: null,
    },
    {
      userId: '33333333-3333-4333-8333-333333333333',
      email: 'owner@tenant.test',
      fullName: 'Owen Owner',
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: null,
    },
  ];

  /** The command `quota-alert.service.ts` actually emits. */
  const quotaAlert = (threshold: number, overrides = {}) => {
    return {
      organizationId: ORG,
      // The ORIGINATING event, never the transport subject.
      type: NOTIFICATION_TYPES.quotaThreshold,
      audience: { kind: 'permission' as const, permission: AUDIENCE },
      // DERIVED, never generated — the property the UNIQUE index relies on.
      eventId: quotaThresholdEventId(ORG, CYCLE_START, threshold),
      title: `AI budget ${threshold}% used`,
      body: 'At 100%, all self-service questions will route to your agents.',
      priority:
        threshold >= 100
          ? NotificationPriority.CRITICAL
          : NotificationPriority.NORMAL,
      occurredAt: new Date().toISOString(),
      resourceType: NotificationResourceType.ORGANIZATION,
      resourceId: ORG,
      ...overrides,
    };
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    inApp = fx.moduleRef.get(InAppNotificationService);

    // auth-service is not running for this suite, and the AUDIENCE is the one
    // variable every test here wants to control.
    const authReference = fx.moduleRef.get(AuthReferenceService);
    listPermissionHolders = jest.spyOn(authReference, 'listPermissionHolders');
    listUsersByIds = jest.spyOn(authReference, 'listUsersByIds');

    // SMTP is never reached. Asserting on the CAPTURED command proves what a
    // recipient would receive without making the test depend on a mail server.
    sendEmail = jest.spyOn(fx.moduleRef.get(EmailService), 'send');
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();

    listPermissionHolders.mockResolvedValue(ADMINS);
    listUsersByIds.mockResolvedValue(ADMINS);
    sendEmail.mockResolvedValue({ messageId: '<smtp-1@synapsedesk>' });
  });

  afterAll(async () => {
    await fx.close();
  });

  describe('a threshold crossing reaches a person', () => {
    it('1. Writes a row EVERY holder of the audience permission can see', async () => {
      // The assertion the finding asks for. Not "was it emitted" — emitting was
      // never the failure.
      await inApp.deliver(quotaAlert(80));

      const rows = await fx.prisma.notification.findMany({
        orderBy: { recipientId: 'asc' },
      });

      expect(
        rows.map((row) => row.recipientId).sort(compareAlphabetically),
      ).toEqual(
        ADMINS.map((admin) => admin.userId).sort(compareAlphabetically),
      );
      expect(rows[0].title).toBe('AI budget 80% used');
      expect(rows[0].organizationId).toBe(ORG);
      // Unread, which is what makes it a notification rather than a log line.
      expect(rows[0].readAt).toBeNull();
    });

    it('2. Stores the ORIGINATING type, not the transport subject — §1.3', async () => {
      // The latent bug here. `type` used to be written as
      // `IN_APP_NOTIFICATION_PATTERN`, identical on every row — harmless with
      // one producer and a blocker with two, because `?type=` would match
      // everything against everything and preference resolution keys on it, so
      // a user could turn EVERYTHING off and nothing in between.
      await inApp.deliver(quotaAlert(80));

      const [row] = await fx.prisma.notification.findMany();

      expect(row.type).toBe(NOTIFICATION_TYPES.quotaThreshold);
      expect(row.type).not.toContain('in_app');
    });

    it('3. Carries the OPERATIONAL consequence, not just the percentage', async () => {
      // api-endpoints-plan is explicit: the 80% message must say what happens
      // at 100%, because at a 70-80% deflection rate the cap is a 3-5x queue
      // spike rather than a billing footnote. A bare percentage reads as noise.
      await inApp.deliver(quotaAlert(80));

      const [row] = await fx.prisma.notification.findMany();
      expect(row.body).toContain('route to your agents');
    });

    it('4. Resolves the audience from the PERMISSION, not a recipient list', async () => {
      // The producer names "whoever can act on this" because it cannot know who
      // that is. Asserting the argument pins that contract from the consumer's
      // side.
      await inApp.deliver(quotaAlert(80));

      expect(listPermissionHolders).toHaveBeenCalledWith(
        ORG,
        AUDIENCE,
        undefined,
      );
    });
  });

  describe('the audience union — §1.3', () => {
    const RECIPIENT = ADMINS[0].userId;

    it('5. A `users` audience makes NO permission lookup', async () => {
      // The bug this union exists to prevent. Resolving `ticket.read` holders
      // for a ticket event would tell every agent in the tenant that one of
      // them got a ticket — so the ABSENCE of the call is the assertion.
      listUsersByIds.mockResolvedValue([ADMINS[0]]);

      await inApp.deliver(
        quotaAlert(80, {
          type: NOTIFICATION_TYPES.ticketAssigned,
          audience: { kind: 'users', userIds: [RECIPIENT] },
        }),
      );

      expect(listPermissionHolders).not.toHaveBeenCalled();
      expect(listUsersByIds).toHaveBeenCalledWith(ORG, [RECIPIENT]);

      const rows = await fx.prisma.notification.findMany();
      expect(rows.map((row) => row.recipientId)).toEqual([RECIPIENT]);
    });

    it('6. A `permission` audience still behaves exactly as before', async () => {
      // The regression guard on the one shipped producer.
      await inApp.deliver(quotaAlert(80));

      expect(listPermissionHolders).toHaveBeenCalledTimes(1);
      await expect(fx.prisma.notification.count()).resolves.toBe(2);
    });

    it('7. An EMPTY `users` audience is dropped, not an error', async () => {
      const outcome = await inApp.deliver(
        quotaAlert(80, { audience: { kind: 'users', userIds: [] } }),
      );

      expect(outcome.created).toBe(0);
      expect(listUsersByIds).not.toHaveBeenCalled();
      await expect(fx.prisma.notification.count()).resolves.toBe(0);
    });

    it('8. Never notifies the ACTOR — §3.1 rule 1', async () => {
      // An agent who assigns a ticket to themselves must not be told about it.
      // Applied centrally, so a new producer gets it for free rather than
      // having to remember.
      await inApp.deliver(quotaAlert(80, { actorId: ADMINS[0].userId }));

      const rows = await fx.prisma.notification.findMany();

      expect(rows).toHaveLength(1);
      expect(rows[0].recipientId).toBe(ADMINS[1].userId);
    });
  });

  describe('redelivery', () => {
    it('9. Delivering the SAME event twice leaves one row per recipient', async () => {
      // Core NATS redelivers and has no dedup of its own, so this is the normal
      // path rather than a rare one. The partial UNIQUE index is the mechanism
      // — and it only works because the producer DERIVES the id.
      const command = quotaAlert(80);

      const first = await inApp.deliver(command);
      const second = await inApp.deliver(command);

      expect(first.created).toBe(2);
      expect(second.created).toBe(0);
      expect(second.duplicates).toBe(2);

      await expect(fx.prisma.notification.count()).resolves.toBe(2);
    });

    it('10. Treats a DIFFERENT threshold as a different notification', async () => {
      await inApp.deliver(quotaAlert(80));
      await inApp.deliver(quotaAlert(100));

      await expect(fx.prisma.notification.count()).resolves.toBe(4);
    });

    it('11. Treats a NEW CYCLE as a new notification', async () => {
      // The cycle is inside the event id, so a billing reset re-arms every
      // threshold with no extra bookkeeping.
      await inApp.deliver(quotaAlert(80));
      await inApp.deliver(
        quotaAlert(80, {
          eventId: quotaThresholdEventId(
            ORG,
            new Date('2026-09-01T00:00:00.000Z'),
            80,
          ),
        }),
      );

      await expect(fx.prisma.notification.count()).resolves.toBe(4);
    });

    it('12. Two rows with a NULL event id both insert — the PARTIAL index', async () => {
      // The whole purpose of `WHERE event_id IS NOT NULL`. Most rows carry no
      // event id at all, and an index that enrolled them would be large, would
      // depend on an engine treating NULLs as distinct, and would break the
      // moment anything relied on the opposite.
      await fx.prisma.notification.createMany({
        data: [
          {
            organizationId: ORG,
            recipientId: ADMINS[0].userId,
            type: NOTIFICATION_TYPES.ticketAssigned,
            title: 'First',
            eventId: null,
          },
          {
            organizationId: ORG,
            recipientId: ADMINS[0].userId,
            type: NOTIFICATION_TYPES.ticketAssigned,
            title: 'Second',
            eventId: null,
          },
        ],
      });

      await expect(fx.prisma.notification.count()).resolves.toBe(2);
    });

    it('13. All four PARTIAL indexes exist after seeding', async () => {
      // Without this, the idempotency tests above pass on the service-layer
      // catch alone and prove nothing about the constraint they claim to
      // exercise — Prisma cannot express `WHERE`, so nothing else would.
      const rows = await fx.prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'notifications'`,
      );
      const names = rows.map((row) => row.indexname);

      expect(names).toEqual(
        expect.arrayContaining([
          'notifications_feed_idx',
          'notifications_unread_idx',
          'notifications_event_key',
          'notifications_group_idx',
        ]),
      );
    });
  });

  describe('email as a second channel', () => {
    it('14. Emails a CRITICAL alert, so 100% is not merely available to read', async () => {
      // An in-app row that sits unread until someone opens the app is a record
      // of a warning, not a warning. RDM §1.14 gives 100% `CRITICAL` precisely
      // so it bypasses quiet hours.
      await inApp.deliver(quotaAlert(100));

      expect(sendEmail).toHaveBeenCalledTimes(2);
      const [command] = sendEmail.mock.calls[0] as [
        { to: string; data: { headline: string; detail: string } },
      ];
      expect(command.to).toBe(ADMINS[0].email);
      expect(command.data.headline).toBe('AI budget 100% used');
      expect(command.data.detail).toContain('route to your agents');
    });

    it('15. Does not RE-EMAIL on a redelivery', async () => {
      // The row is the idempotency record for both channels, which is why it is
      // written first. Without this, a NATS retry storm becomes a mail storm.
      const command = quotaAlert(100);

      await inApp.deliver(command);
      sendEmail.mockClear();
      await inApp.deliver(command);

      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('16. Still writes the ROW when the mail transport fails', async () => {
      // The channels degrade independently. Losing SMTP must not lose the
      // notification — and the in-app row is the one that survives a restart.
      sendEmail.mockRejectedValue(new Error('smtp is down'));

      const outcome = await inApp.deliver(quotaAlert(100));

      expect(outcome.created).toBe(2);
      expect(outcome.emailed).toBe(0);
      await expect(fx.prisma.notification.count()).resolves.toBe(2);
    });
  });

  describe('delivery records — §5', () => {
    it('17. Writes an IN_APP delivery row for every notification', async () => {
      // Even though the in-app channel cannot fail: this table answers "was I
      // notified at all, and on what", and a channel missing from it reads as
      // one that was never tried.
      await inApp.deliver(quotaAlert(80));

      const deliveries = await fx.prisma.notificationDelivery.findMany({
        where: { channel: NotificationChannel.IN_APP },
      });

      expect(deliveries).toHaveLength(2);
      expect(deliveries[0].status).toBe(DeliveryStatus.SENT);
    });

    it('18. Records the provider message id on a sent email', async () => {
      // Captured now because it cannot be recovered later: it is what
      // correlates a bounce webhook back to the row that sent the mail, and
      // nothing consumes those webhooks yet.
      await inApp.deliver(quotaAlert(100));

      const [delivery] = await fx.prisma.notificationDelivery.findMany({
        where: { channel: NotificationChannel.EMAIL },
      });

      expect(delivery.status).toBe(DeliveryStatus.SENT);
      expect(delivery.providerMessageId).toBe('<smtp-1@synapsedesk>');
      // The address AT SEND TIME, snapshotted — preserved if the user later
      // changes it, so the record still says where the mail actually went.
      expect(delivery.target).toBe(ADMINS[0].email);
    });

    it('19. Records FAILED with the error when the transport throws', async () => {
      sendEmail.mockRejectedValue(new Error('smtp is down'));

      await inApp.deliver(quotaAlert(100));

      const [delivery] = await fx.prisma.notificationDelivery.findMany({
        where: { channel: NotificationChannel.EMAIL },
      });

      expect(delivery.status).toBe(DeliveryStatus.FAILED);
      expect(delivery.errorLog).toContain('smtp is down');
    });

    it('20. Writes SKIPPED with a REASON when a preference disables the channel', async () => {
      // **The auditable-drop rule.** "I never got notified" is unanswerable
      // without this, and it is the single most common support question this
      // feature will generate.
      await fx.prisma.notificationPreference.create({
        data: {
          userId: ADMINS[0].userId,
          organizationId: ORG,
          type: NOTIFICATION_TYPES.quotaThreshold,
          channel: NotificationChannel.EMAIL,
          isEnabled: false,
        },
      });

      await inApp.deliver(quotaAlert(100));

      const skipped = await fx.prisma.notificationDelivery.findMany({
        where: { status: DeliveryStatus.SKIPPED },
      });

      expect(skipped).toHaveLength(1);
      expect(skipped[0].skipReason).toBe(DeliverySkipReason.USER_PREFERENCE);
      // Not counted as an attempt: a skip is not a failed try, and counting it
      // as one would make a user with quiet hours look like a bouncing address.
      expect(skipped[0].attempts).toBe(0);

      // The OTHER admin still got theirs — one user's preference is not a
      // tenant-wide mute.
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it('21. A DIGEST of OFF suppresses the channel too', async () => {
      await fx.prisma.notificationPreference.create({
        data: {
          userId: ADMINS[0].userId,
          organizationId: ORG,
          type: NOTIFICATION_TYPES.quotaThreshold,
          channel: NotificationChannel.EMAIL,
          isEnabled: true,
          digest: DigestMode.OFF,
        },
      });

      await inApp.deliver(quotaAlert(100));

      const skipped = await fx.prisma.notificationDelivery.findMany({
        where: { status: DeliveryStatus.SKIPPED },
      });
      expect(skipped).toHaveLength(1);
    });

    it('22. Deleting a notification CASCADES its delivery rows', async () => {
      await inApp.deliver(quotaAlert(80));
      const [row] = await fx.prisma.notification.findMany();

      await fx.prisma.notification.delete({ where: { id: row.id } });

      await expect(
        fx.prisma.notificationDelivery.count({
          where: { notificationId: row.id },
        }),
      ).resolves.toBe(0);
    });

    it('23. One row per channel per notification — a retry UPSERTS', async () => {
      const command = quotaAlert(100);

      await inApp.deliver(command);
      await inApp.deliver(command);

      const perNotification = await fx.prisma.notificationDelivery.groupBy({
        by: ['notificationId', 'channel'],
        _count: true,
      });

      expect(perNotification.every((group) => group._count === 1)).toBe(true);
    });
  });

  describe('real-time — §6', () => {
    it('24. Publishes `notification.created` for the socket to relay', async () => {
      await inApp.deliver(quotaAlert(80));

      const created = fx.emitted.filter(
        (event) => event.pattern === NOTIFICATION_REALTIME_PATTERNS.created,
      );

      expect(created).toHaveLength(2);
      const payload = created[0].payload as { recipientId: string };
      // Per RECIPIENT, because the gateway fans it into `user:{id}` — one event
      // carrying a list would either need the gateway to loop or would reach
      // the wrong rooms.
      expect(ADMINS.map((admin) => admin.userId)).toContain(
        payload.recipientId,
      );
    });

    it('25. Publishes NOTHING for a duplicate — the toast is not repeated', async () => {
      const command = quotaAlert(80);

      await inApp.deliver(command);
      fx.emitted.length = 0;
      await inApp.deliver(command);

      expect(fx.emitted).toHaveLength(0);
    });
  });

  describe('degraded inputs', () => {
    it('26. Writes NOTHING when nobody holds the audience permission', async () => {
      // A real configuration, and worth a log line: it means the person who
      // would upgrade the plan will never hear about the cap.
      listPermissionHolders.mockResolvedValue([]);

      const outcome = await inApp.deliver(quotaAlert(80));

      expect(outcome).toEqual({
        recipients: 0,
        created: 0,
        grouped: 0,
        duplicates: 0,
        emailed: 0,
      });
      await expect(fx.prisma.notification.count()).resolves.toBe(0);
    });

    it('27. Drops the event rather than mailing everyone when auth-service is down', async () => {
      // The resolver returns an empty audience on an outage — the OPPOSITE
      // direction from the entitlement read, deliberately. An unreadable budget
      // must not be treated as unlimited because that spends money; an
      // unresolvable audience costs one notification.
      listPermissionHolders.mockResolvedValue([]);

      await inApp.deliver(quotaAlert(100));

      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('28. One recipient failing does not cost the others theirs', async () => {
      // Existing posture in `deliver()`, kept under the new fan-out. A fan-out
      // that aborts halfway is worse than one that loses a single row: the
      // recipients it never reached have no record anything was attempted.
      const create = jest
        .spyOn(fx.prisma.notification, 'create')
        .mockRejectedValueOnce(new Error('injected failure'));

      try {
        const outcome = await inApp.deliver(quotaAlert(80));

        expect(outcome.created).toBe(1);
        await expect(fx.prisma.notification.count()).resolves.toBe(1);
      } finally {
        create.mockRestore();
      }
    });
  });
});
