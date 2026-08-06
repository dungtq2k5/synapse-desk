import {
  IN_APP_NOTIFICATION_PATTERN,
  NotificationPriority,
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
 * §16 H1 — the alert reaching a human.
 *
 * **Every assertion here is on something a user could SEE**: a row in their
 * feed, or a captured outbound email. That is the whole point of the finding —
 * the emit was never the failure. `quota-alert.service.ts` published correctly,
 * idempotently, to the right audience, into a subject with no subscriber, and a
 * test asserting the emit is exactly what let it reach production looking
 * finished.
 */
describe('§1 In-app notification delivery (e2e)', () => {
  let fx: E2eFixture;
  let inApp: InAppNotificationService;

  let listPermissionHolders: jest.SpyInstance;
  let sendEmail: jest.SpyInstance;

  const ADMINS = [
    {
      userId: '22222222-2222-4222-8222-222222222222',
      email: 'admin@tenant.test',
      fullName: 'Ada Admin',
    },
    {
      userId: '33333333-3333-4333-8333-333333333333',
      email: 'owner@tenant.test',
      fullName: 'Owen Owner',
    },
  ];

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    inApp = fx.moduleRef.get(InAppNotificationService);

    // auth-service is not running for this suite, and the AUDIENCE is the one
    // variable every test here wants to control.
    listPermissionHolders = jest.spyOn(
      fx.moduleRef.get(AuthReferenceService),
      'listPermissionHolders',
    );

    // SMTP is never reached. Asserting on the CAPTURED command proves what a
    // recipient would receive without making the test depend on a mail server.
    sendEmail = jest.spyOn(fx.moduleRef.get(EmailService), 'send');
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();

    listPermissionHolders.mockResolvedValue(ADMINS);
    sendEmail.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await fx.close();
  });

  /** The command `quota-alert.service.ts` actually emits. */
  function quotaAlert(threshold: number, overrides = {}) {
    return {
      organizationId: ORG,
      audiencePermission: AUDIENCE,
      // DERIVED, never generated — the property the UNIQUE constraint relies on.
      eventId: quotaThresholdEventId(ORG, CYCLE_START, threshold),
      title: `AI budget ${threshold}% used`,
      body:
        threshold >= 100
          ? 'At 100%, all self-service questions will route to your agents.'
          : `At 100%, all self-service questions will route to your agents.`,
      priority:
        threshold >= 100
          ? NotificationPriority.CRITICAL
          : NotificationPriority.NORMAL,
      occurredAt: new Date().toISOString(),
      ...overrides,
    };
  }

  describe('a threshold crossing reaches a person', () => {
    it('1. Writes a row EVERY holder of the audience permission can see', async () => {
      // The assertion the finding asks for. Not "was it emitted" — emitting was
      // never the failure.
      await inApp.deliver(quotaAlert(80));

      const rows = await fx.prisma.notification.findMany({
        orderBy: { recipientId: 'asc' },
      });

      expect(rows.map((row) => row.recipientId).sort()).toEqual(
        ADMINS.map((admin) => admin.userId).sort(),
      );
      expect(rows[0].title).toBe('AI budget 80% used');
      expect(rows[0].organizationId).toBe(ORG);
      expect(rows[0].type).toBe(IN_APP_NOTIFICATION_PATTERN);
      // Unread, which is what makes it a notification rather than a log line.
      expect(rows[0].readAt).toBeNull();
    });

    it('2. Carries the OPERATIONAL consequence, not just the percentage', async () => {
      // api-endpoints-plan is explicit: the 80% message must say what happens
      // at 100%, because at a 70-80% deflection rate the cap is a 3-5x queue
      // spike rather than a billing footnote. A bare percentage reads as noise.
      await inApp.deliver(quotaAlert(80));

      const [row] = await fx.prisma.notification.findMany();
      expect(row.body).toContain('route to your agents');
    });

    it('3. Resolves the audience from the PERMISSION, not a recipient list', async () => {
      // The producer names "whoever can act on this" because it cannot know who
      // that is. Asserting the argument pins that contract from the consumer's
      // side.
      await inApp.deliver(quotaAlert(80));

      expect(listPermissionHolders).toHaveBeenCalledWith(ORG, AUDIENCE);
    });
  });

  describe('redelivery', () => {
    it('4. Delivering the SAME event twice leaves one row per recipient', async () => {
      // Core NATS redelivers and has no dedup of its own, so this is the normal
      // path rather than a rare one. The `UNIQUE (recipient_id, event_id)`
      // constraint is the mechanism — and it only works because the producer
      // DERIVES the id from the threshold crossing rather than generating one.
      const command = quotaAlert(80);

      const first = await inApp.deliver(command);
      const second = await inApp.deliver(command);

      expect(first.created).toBe(2);
      expect(second.created).toBe(0);
      expect(second.duplicates).toBe(2);

      await expect(fx.prisma.notification.count()).resolves.toBe(2);
    });

    it('5. Treats a DIFFERENT threshold as a different notification', async () => {
      // 80% and 100% are two things worth being told, and the event id carries
      // the threshold precisely so the second is not swallowed as a duplicate
      // of the first.
      await inApp.deliver(quotaAlert(80));
      await inApp.deliver(quotaAlert(100));

      await expect(fx.prisma.notification.count()).resolves.toBe(4);
    });

    it('6. Treats a NEW CYCLE as a new notification', async () => {
      // The cycle is inside the event id, so a billing reset re-arms every
      // threshold with no extra bookkeeping — the same property that makes the
      // Redis counter reset for free.
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
  });

  describe('email as a second channel', () => {
    it('7. Emails a CRITICAL alert, so 100% is not merely available to read', async () => {
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

    it('8. Does NOT email a NORMAL 80% crossing', async () => {
      // Emailing every 80% crossing to every admin is how a channel earns the
      // filter that then hides the 100% one.
      await inApp.deliver(quotaAlert(80));

      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('9. Does not RE-EMAIL on a redelivery', async () => {
      // The row is the idempotency record for both channels, which is why it is
      // written first. Without this, a NATS retry storm becomes a mail storm.
      const command = quotaAlert(100);

      await inApp.deliver(command);
      sendEmail.mockClear();
      await inApp.deliver(command);

      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('10. Still writes the ROW when the mail transport fails', async () => {
      // The channels degrade independently. Losing SMTP must not lose the
      // notification — and the in-app row is the one that survives a restart.
      sendEmail.mockRejectedValue(new Error('smtp is down'));

      const outcome = await inApp.deliver(quotaAlert(100));

      expect(outcome.created).toBe(2);
      expect(outcome.emailed).toBe(0);
      await expect(fx.prisma.notification.count()).resolves.toBe(2);
    });
  });

  describe('degraded inputs', () => {
    it('11. Writes NOTHING when nobody holds the audience permission', async () => {
      // A real configuration, and worth a log line: it means the person who
      // would upgrade the plan will never hear about the cap.
      listPermissionHolders.mockResolvedValue([]);

      const outcome = await inApp.deliver(quotaAlert(80));

      expect(outcome).toEqual({
        recipients: 0,
        created: 0,
        duplicates: 0,
        emailed: 0,
      });
      await expect(fx.prisma.notification.count()).resolves.toBe(0);
    });

    it('12. Drops the event rather than mailing everyone when auth-service is down', async () => {
      // The resolver returns an empty audience on an outage — the OPPOSITE
      // direction from the entitlement read, deliberately. An unreadable budget
      // must not be treated as unlimited because that spends money; an
      // unresolvable audience costs one notification.
      listPermissionHolders.mockResolvedValue([]);

      await inApp.deliver(quotaAlert(100));

      expect(sendEmail).not.toHaveBeenCalled();
    });
  });
});
