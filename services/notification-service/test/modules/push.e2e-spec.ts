import {
  DeliverySkipReason,
  DeliveryStatus,
  NOTIFICATION_TYPES,
  NotificationChannel,
  NotificationPriority,
  DevicePlatform,
  NotificationResourceType,
  limitThresholdEventId,
  TICKET_PATTERNS,
} from '@synapsedesk/common';
import {
  DevicePlatform as ProtoDevicePlatform,
  packRequestContext,
} from '@synapsedesk/grpc-proto';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { InAppNotificationService } from '../../src/modules/in-app/in-app-notification.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { EmailService } from '../../src/modules/email/email.service';
import { FirebaseMessagingService } from '../../src/modules/push/firebase-messaging.service';
import { DeviceTokenService } from '../../src/modules/push/device-token.service';
import { TicketNotificationConsumer } from '../../src/modules/in-app/ticket-notification.consumer';
import { NotificationsGrpcController } from '../../src/modules/feed/notifications-grpc.controller';

/**
 * The push channel.
 *
 * **Every test here is server-side by necessity.** There is no client in this
 * repository — seven services and no mobile app — so nothing can register a
 * real token or receive a real push, and the FCM SDK is mocked at the
 * `sendEachForMulticast` boundary. That means §4's error-code mapping is
 * verified against a FIXTURE rather than against Firebase: the same "the
 * premise cannot be settled from this repository" shape as the `creditIssued`
 * assertion in `plan-change.e2e-spec.ts`, and it wants the same honesty rather
 * than a claim of coverage. Getting a code wrong in the KEEP direction is harmless; wrong in
 * the DELETE direction silently unsubscribes a user.
 */
describe('Push notifications (e2e)', () => {
  let fx: E2eFixture;
  let inApp: InAppNotificationService;
  let devices: DeviceTokenService;

  let listPermissionHolders: jest.SpyInstance;
  let listUsersByIds: jest.SpyInstance;
  let sendEmail: jest.SpyInstance;
  let sendEachForMulticast: jest.SpyInstance;

  const ORG = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';
  const AUDIENCE = 'organization.update';

  const RECIPIENT = {
    userId: USER,
    email: 'admin@tenant.test',
    fullName: 'Ada Admin',
    quietHoursStart: null as string | null,
    quietHoursEnd: null as string | null,
    timezone: null as string | null,
  };

  /** A window that CONTAINS the moment this test runs — see the in-app suite. */
  const nowIsQuiet = () => {
    const hh = (offset: number) =>
      String((new Date().getUTCHours() + offset + 24) % 24).padStart(2, '0');

    return {
      quietHoursStart: `${hh(-1)}:00`,
      quietHoursEnd: `${hh(1)}:00`,
      timezone: 'UTC',
    };
  };

  const alert = (priority: NotificationPriority, threshold = 80) => ({
    organizationId: ORG,
    type: NOTIFICATION_TYPES.limitThreshold,
    audience: { kind: 'permission' as const, permission: AUDIENCE },
    eventId: limitThresholdEventId(ORG, 'seats', threshold, Date.now()),
    title: `Seats ${threshold}% used`,
    body: 'Inviting another teammate will be refused at 100%.',
    priority,
    occurredAt: new Date().toISOString(),
    resourceType: NotificationResourceType.ORGANIZATION,
    resourceId: ORG,
    actionUrl: '/settings/billing',
  });

  /** FCM's shape: positional responses, one per token, carrying no token. */
  const fcmResult = (outcomes: (true | string)[]) => ({
    successCount: outcomes.filter((outcome) => outcome === true).length,
    failureCount: outcomes.filter((outcome) => outcome !== true).length,
    responses: outcomes.map((outcome) =>
      outcome === true
        ? { success: true }
        : { success: false, error: { code: outcome } },
    ),
  });

  const registerDevices = async (count: number) => {
    for (let index = 0; index < count; index++) {
      await devices.register({
        userId: USER,
        organizationId: ORG,
        token: `tok-${index}`,
        platform: DevicePlatform.ANDROID,
        deviceName: `Device ${index}`,
      });
    }
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    inApp = fx.moduleRef.get(InAppNotificationService);
    devices = fx.moduleRef.get(DeviceTokenService);
  });

  beforeEach(async () => {
    await fx.reset();

    // **Re-spied every test, not once in `beforeAll`.** Test 14 restores the
    // FCM spy to reach the real method, and a spy created once is gone for
    // every test after it — `mockResolvedValue` on a restored spy stubs
    // nothing and the call goes through to an unconfigured client. Measured:
    // test 10 passed alone and failed the moment 14 was added above it.
    jest.restoreAllMocks();

    listPermissionHolders = jest.spyOn(
      fx.moduleRef.get(AuthReferenceService),
      'listPermissionHolders',
    );
    listUsersByIds = jest.spyOn(
      fx.moduleRef.get(AuthReferenceService),
      'listUsersByIds',
    );
    sendEmail = jest.spyOn(fx.moduleRef.get(EmailService), 'send');
    sendEachForMulticast = jest.spyOn(
      fx.moduleRef.get(FirebaseMessagingService),
      'sendEachForMulticast',
    );
    listPermissionHolders.mockResolvedValue([RECIPIENT]);
    listUsersByIds.mockResolvedValue([RECIPIENT]);
    sendEmail.mockResolvedValue({ messageId: '<sent-1@synapsedesk>' });
    sendEachForMulticast.mockResolvedValue(fcmResult([true]));
  });

  afterAll(async () => {
    await fx.close();
  });

  // --------------------------------------------------------- the gate

  it('1. **A HIGH notification pushes; a NORMAL one writes no row at all**', async () => {
    // Copying email's `CRITICAL`-only gate would reproduce the gap this channel
    // closes: a phone user would still learn nothing about a ticket assigned to
    // them, an escalation, or 80% storage — precisely what a mobile client is
    // for. And below the gate there is no row, for email's own reason: a
    // SKIPPED row per ticket reply buries the rows that answer real questions.
    await registerDevices(1);

    await inApp.deliver(alert(NotificationPriority.HIGH));
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    await fx.reset();
    await registerDevices(1);

    await inApp.deliver(alert(NotificationPriority.NORMAL, 95));

    expect(sendEachForMulticast).not.toHaveBeenCalled();
    await expect(
      fx.prisma.notificationDelivery.count({
        where: { channel: NotificationChannel.PUSH },
      }),
    ).resolves.toBe(0);
  });

  // ------------------------------------------------- one row per person

  it('2. **Three devices, ONE delivery row, `target` naming the count**', async () => {
    // `@@unique([notificationId, channel])` is the design rather than a limit
    // to work around: the table answers "did we tell this person, and if not
    // why", and that has one answer per person however many phones they own.
    // Per-device outcome lives on `device_tokens`.
    //
    // **The constraint does NOT catch a per-device write, which is the reason
    // this assertion is on `target` rather than on the row count alone.**
    // `DeliveryRecorder.recordSent` UPSERTS on `(notificationId, channel)`, so
    // a loop writing one row per token collapses into a single row whose
    // `target` is the last token — no violation, no error, and a row count of
    // exactly 1. Measured: the sabotage that writes per-token leaves the suite
    // green until `target` is checked. The schema makes the shape
    // unrepresentable; it does not make the mistake loud.
    await registerDevices(3);
    sendEachForMulticast.mockResolvedValue(fcmResult([true, true, true]));

    await inApp.deliver(alert(NotificationPriority.HIGH));

    const rows = await fx.prisma.notificationDelivery.findMany({
      where: { channel: NotificationChannel.PUSH },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe('3 devices');
    expect(rows[0].status).toBe(DeliveryStatus.SENT);
    // Null on purpose: FCM returns one id per token, and picking the first
    // would be a record pointing at one arbitrary device.
    expect(rows[0].providerMessageId).toBeNull();
  });

  // --------------------------------------------------- token staleness

  it('3. **Only the two dead codes delete a token**', async () => {
    // The one path where this system destroys a stored credential because a
    // third party said so. A broad catch-and-delete turns an FCM outage into
    // every user silently losing push, with no error and no way back except
    // reinstalling the app.
    await registerDevices(3);
    sendEachForMulticast.mockResolvedValue(
      fcmResult([
        'messaging/registration-token-not-registered',
        'messaging/server-unavailable',
        true,
      ]),
    );

    await inApp.deliver(alert(NotificationPriority.HIGH));

    const remaining = await fx.prisma.deviceToken.findMany({
      orderBy: { token: 'asc' },
    });

    // The transient failure and the success both survive; only the dead one goes.
    expect(remaining.map((row) => row.token)).toEqual(['tok-1', 'tok-2']);
  });

  it('4. **Every token dead is BOUNCED; one alive is SENT**', async () => {
    // `BOUNCED` means "every device we knew about is gone" — materially
    // different from `FAILED`, which is "the transport did not work this time".
    // This is the enum member's first producer.
    await registerDevices(2);
    sendEachForMulticast.mockResolvedValue(
      fcmResult([
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
      ]),
    );

    await inApp.deliver(alert(NotificationPriority.HIGH));

    const row = await fx.prisma.notificationDelivery.findFirstOrThrow({
      where: { channel: NotificationChannel.PUSH },
    });
    expect(row.status).toBe(DeliveryStatus.BOUNCED);
    await expect(fx.prisma.deviceToken.count()).resolves.toBe(0);
  });

  it('4b. …and a PARTIAL success is SENT, not FAILED', async () => {
    await registerDevices(2);
    sendEachForMulticast.mockResolvedValue(
      fcmResult(['messaging/registration-token-not-registered', true]),
    );

    await inApp.deliver(alert(NotificationPriority.HIGH));

    const row = await fx.prisma.notificationDelivery.findFirstOrThrow({
      where: { channel: NotificationChannel.PUSH },
    });
    expect(row.status).toBe(DeliveryStatus.SENT);
    expect(row.target).toBe('2 devices');
  });

  // ------------------------------------------------------ registration

  it('5. **Re-registering a token UPDATES the row, including across users**', async () => {
    // `token` is unique rather than `(userId, token)`: FCM reissues, and a
    // shared tablet two people sign into must not deliver one person's
    // notifications to the other.
    await devices.register({
      userId: USER,
      organizationId: ORG,
      token: 'shared-tok',
      platform: DevicePlatform.ANDROID,
    });
    await devices.register({
      userId: USER,
      organizationId: ORG,
      token: 'shared-tok',
      platform: DevicePlatform.ANDROID,
      deviceName: 'Renamed',
    });

    await expect(fx.prisma.deviceToken.count()).resolves.toBe(1);

    const OTHER_USER = '33333333-3333-4333-8333-333333333333';
    await devices.register({
      userId: OTHER_USER,
      organizationId: ORG,
      token: 'shared-tok',
      platform: DevicePlatform.ANDROID,
    });

    const rows = await fx.prisma.deviceToken.findMany();
    expect(rows).toHaveLength(1);
    // It MOVED rather than duplicating — the old owner no longer receives it.
    expect(rows[0].userId).toBe(OTHER_USER);
  });

  // ------------------------------------------------------ no devices

  it('6. **A user with no devices gets no delivery row at all**', async () => {
    // Not a skip: nothing was suppressed, there was nowhere to send. A SKIPPED
    // row per notification per web-only user would bury the rows that answer
    // real questions.
    await inApp.deliver(alert(NotificationPriority.HIGH));

    expect(sendEachForMulticast).not.toHaveBeenCalled();
    await expect(
      fx.prisma.notificationDelivery.count({
        where: { channel: NotificationChannel.PUSH },
      }),
    ).resolves.toBe(0);
  });

  // ----------------------------------------------------- quiet hours

  it('7. **Quiet hours suppress a HIGH push, and CRITICAL bypasses them**', async () => {
    // The first channel where quiet hours can fire at all. Email's gate is
    // `CRITICAL`-only and the resolver exempts `CRITICAL`, so the two are
    // mutually exclusive there — the window was fetched, resolvable and unit
    // tested, and had no reachable producer until this arm existed.
    listPermissionHolders.mockResolvedValue([
      { ...RECIPIENT, ...nowIsQuiet() },
    ]);
    await registerDevices(1);

    await inApp.deliver(alert(NotificationPriority.HIGH));

    expect(sendEachForMulticast).not.toHaveBeenCalled();
    const skipped = await fx.prisma.notificationDelivery.findFirstOrThrow({
      where: { channel: NotificationChannel.PUSH },
    });
    expect(skipped.status).toBe(DeliveryStatus.SKIPPED);
    expect(skipped.skipReason).toBe(DeliverySkipReason.QUIET_HOURS);

    // And the bypass: a 100% cap or a dunning notice is what a tenant would
    // rather be woken for.
    await fx.reset();
    jest.clearAllMocks();
    listPermissionHolders.mockResolvedValue([
      { ...RECIPIENT, ...nowIsQuiet() },
    ]);
    sendEachForMulticast.mockResolvedValue(fcmResult([true]));
    await registerDevices(1);

    await inApp.deliver(alert(NotificationPriority.CRITICAL, 100));

    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  it('11. **`DeliveryOutcome.pushed` reports what the fan-out did**', async () => {
    // The type's docblock says "for the log and the tests", and `pushed` was
    // computed, logged, and left out of the return — so every push assertion
    // had to go through `notification_deliveries`, which answers what was
    // RECORDED rather than what the fan-out did.
    await registerDevices(2);
    sendEachForMulticast.mockResolvedValue(fcmResult([true, true]));

    const outcome = await inApp.deliver(alert(NotificationPriority.HIGH));

    // PEOPLE reached, not devices — the same unit the delivery row uses.
    expect(outcome.pushed).toBe(1);
    expect(outcome.recipients).toBe(1);

    // And zero when the gate refuses, rather than absent.
    const below = await inApp.deliver(alert(NotificationPriority.NORMAL, 95));
    expect(below.pushed).toBe(0);
  });

  it('12. **A type with no push arm dials nothing and writes no row**', async () => {
    // `pushFor` is a pure function of `command.type`, and it used to run AFTER
    // `resolve()` and `listForUser()` — two queries and a possible SKIPPED row.
    // A user with push disabled could be handed a `USER_PREFERENCE` row for a
    // notification that had no push to suppress: the noise the no-row rule
    // exists to prevent, arriving through the other door.
    await registerDevices(1);

    // **The preference must DENY, or this test cannot see the difference.**
    // With `pushFor` inside the loop the wasted work is invisible when the
    // resolver allows — it returns null and continues, writing nothing. The
    // row only appears on the deny path, which is exactly the case the hoist
    // is about: a `USER_PREFERENCE` row for a notification that had no push to
    // suppress. Measured: without this the sabotage stayed green.
    await fx.prisma.notificationPreference.create({
      data: {
        userId: USER,
        organizationId: ORG,
        type: NOTIFICATION_TYPES.planChanged,
        channel: NotificationChannel.PUSH,
        isEnabled: false,
      },
    });

    const outcome = await inApp.deliver({
      ...alert(NotificationPriority.HIGH),
      // `plan.changed` has a `null` arm. Delivered at HIGH here on purpose:
      // the gate must not be what saves us, or this asserts nothing about the
      // hoist.
      type: NOTIFICATION_TYPES.planChanged,
      eventId: `plan-changed:${ORG}:hoist`,
    });

    expect(outcome.pushed).toBe(0);
    expect(sendEachForMulticast).not.toHaveBeenCalled();
    await expect(
      fx.prisma.notificationDelivery.count({
        where: { channel: NotificationChannel.PUSH },
      }),
    ).resolves.toBe(0);
  });

  it('13. **The gRPC edge refuses a platform the enum does not name**', async () => {
    // `@IsEnum` guards the REST edge; this is the other half §7.3 asks for —
    // the mapper on the gRPC edge, behind the wire's own enum. Anything
    // reaching the RPC without the DTO (another service, a test, a future
    // internal caller) is refused rather than stored. The column is
    // display-only today, which is what makes it worth closing: it is the
    // field a per-platform payload difference would branch on.
    const controller = fx.moduleRef.get(NotificationsGrpcController);
    const context = packRequestContext({
      sub: USER,
      organizationId: ORG,
      ip: '127.0.0.1',
      userAgent: 'jest',
    });

    // `UNSPECIFIED` is what the wire delivers for an omitted value, and
    // ts-proto answers `UNRECOGNIZED` for a number outside the enum. The
    // mapper refuses both rather than defaulting: a device silently recorded
    // as `WEB` is a wrong answer on a settings screen.
    await expect(
      controller.registerDevice(
        {
          token: 'tok-bad',
          platform: ProtoDevicePlatform.DEVICE_PLATFORM_UNSPECIFIED,
        },
        context,
      ),
    ).rejects.toThrow(/must name a platform/);

    await expect(fx.prisma.deviceToken.count()).resolves.toBe(0);

    // And a real one is stored as the DOMAIN value, not the wire's number.
    await controller.registerDevice(
      { token: 'tok-good', platform: ProtoDevicePlatform.DEVICE_PLATFORM_IOS },
      context,
    );

    const stored = await fx.prisma.deviceToken.findFirstOrThrow();
    expect(stored.platform).toBe(DevicePlatform.IOS);
  });

  it('14. **A short response array is refused rather than mismapped**', async () => {
    // FCM's responses carry no token of their own — they are positional — so
    // the dead-token mapping reads `responses[i]` as `tokens[i]`. A short or
    // reordered array would delete the WRONG person's device, silently, and
    // nothing in the SDK's types states the guarantee.
    //
    // **The private client is replaced rather than the public method stubbed.**
    // Stubbing `sendEachForMulticast` would stub the assertion along with it;
    // asserting the unconfigured throw instead tests a different branch
    // entirely — measured, an earlier version of this test did exactly that and
    // stayed green when the assertion was deleted.
    // The suite-wide spy intercepts the public method, so the real body — and
    // the assertion in it — never runs until the spy is restored. `beforeEach`
    // re-creates it for the next test.
    sendEachForMulticast.mockRestore();

    const messaging = fx.moduleRef.get(FirebaseMessagingService);
    const injected = messaging as unknown as {
      messaging: { sendEachForMulticast: jest.Mock };
    };
    const original = injected.messaging;

    injected.messaging = {
      sendEachForMulticast: jest.fn().mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      }),
    };

    try {
      await expect(
        messaging.sendEachForMulticast(['a', 'b'], { data: {} }),
      ).rejects.toThrow(/positional mapping cannot be trusted/);
    } finally {
      injected.messaging = original;
    }
  });

  // ------------------------------------------- the producer's own priority

  it('10. **A real `ticket.assigned` event reaches a phone**', async () => {
    // The finding the validation round existed for: the gate was lowered to
    // `HIGH` so an assignee would learn from their phone, and the producer
    // published `ticket.assigned` at `NORMAL` — so the notification the
    // decision was made for was the one it did not reach. Both halves were
    // individually correct, which is why nothing was red.
    //
    // **Behavioural rather than a scan.** Asserting that `pushFor`'s arms and
    // the consumer's priorities agree is two files' text matching, and is
    // satisfiable without either being right. This drives the real consumer.
    const consumer = fx.moduleRef.get(TicketNotificationConsumer);
    listUsersByIds.mockResolvedValue([RECIPIENT]);
    await registerDevices(1);

    await consumer.ticketAssigned({
      pattern: TICKET_PATTERNS.assigned,
      organizationId: ORG,
      ticketId: '44444444-4444-4444-8444-444444444444',
      ticketNumber: 1042,
      occurredAt: new Date().toISOString(),
      assignedToId: USER,
      assignedById: '55555555-5555-4555-8555-555555555555',
      departmentId: '66666666-6666-4666-8666-666666666666',
    });

    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);

    const row = await fx.prisma.notificationDelivery.findFirstOrThrow({
      where: { channel: NotificationChannel.PUSH },
    });
    expect(row.status).toBe(DeliveryStatus.SENT);
  });

  // ------------------------------------------------- unconfigured FCM

  it('9. **With no FCM credential the service still serves email and the feed**', async () => {
    // The only failure that takes three working channels down with the fourth.
    // `.env.test` sets no `FIREBASE_MESSAGING_SERVICE_ACCOUNT_PATH`, so this
    // suite has been running against an unconfigured FCM throughout — which is
    // the point: the service booted.
    const messaging = fx.moduleRef.get(FirebaseMessagingService);
    expect(messaging.isConfigured).toBe(false);

    sendEachForMulticast.mockRestore();
    await registerDevices(1);

    const outcome = await inApp.deliver(
      alert(NotificationPriority.CRITICAL, 100),
    );

    // The feed row and the email both happened.
    expect(outcome.created).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    // And push is VISIBLY off rather than silently absent — a channel that
    // cannot send has to say so in the table people read to answer "why didn't
    // I get notified".
    const row = await fx.prisma.notificationDelivery.findFirstOrThrow({
      where: { channel: NotificationChannel.PUSH },
    });
    expect(row.status).toBe(DeliveryStatus.FAILED);
    expect(row.errorLog).toContain('not configured');
  });
});
