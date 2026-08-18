import {
  IN_APP_NOTIFICATION_PATTERN,
  NOTIFICATION_REALTIME_PATTERNS,
  NOTIFICATION_PATTERNS,
  NOTIFICATION_TYPES,
  NotificationPriority,
  TICKET_PATTERNS,
  compareAlphabetically,
} from '@synapsedesk/common';
import { bootstrapE2eTest, E2eFixture } from './utils/bootstrap';
import { NotificationsController } from '../src/modules/notifications.controller';
import { TicketNotificationConsumer } from '../src/modules/in-app/ticket-notification.consumer';
import { NotificationsGrpcController } from '../src/modules/feed/notifications-grpc.controller';
import { AuthReferenceService } from '../src/modules/auth-client/auth-reference.service';
import { NotificationRealtimePublisher } from '../src/modules/realtime/notification-realtime.publisher';

/**
 * The HYBRID conversion.
 *
 * This service was NATS-only for its whole life. Adding a gRPC server is the
 * change that risks a specific regression: `NestFactory.create` +
 * `connectMicroservice` is a different bootstrap from `createMicroservice`, and
 * the failure mode is not a crash — it is a process that serves gRPC happily
 * while silently consuming no events at all.
 *
 * So test 2 is the one that matters: the NATS handlers must still be reachable
 * and must still write rows.
 */
describe('Notification-service foundations (e2e)', () => {
  let fx: E2eFixture;

  const ORG = '11111111-1111-4111-8111-111111111111';
  const RECIPIENT = '22222222-2222-4222-8222-222222222222';

  const natsContext = {
    getSubject: () => IN_APP_NOTIFICATION_PATTERN,
  } as never;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();

    jest
      .spyOn(fx.moduleRef.get(AuthReferenceService), 'listPermissionHolders')
      .mockResolvedValue([
        {
          userId: RECIPIENT,
          email: 'admin@tenant.test',
          fullName: 'Ada Admin',
          quietHoursStart: null,
          quietHoursEnd: null,
          timezone: null,
        },
      ]);
  });

  beforeEach(() => fx.reset());
  afterAll(() => fx.close());

  it('1. boots with BOTH surfaces wired — the gRPC controller and the NATS ones', () => {
    // Not a smoke test in the usual sense. A hybrid app that failed to
    // register one transport's controllers still boots, still passes a health
    // check, and answers nothing on the half that is missing.
    expect(fx.moduleRef.get(NotificationsGrpcController)).toBeDefined();
    expect(fx.moduleRef.get(NotificationsController)).toBeDefined();
    expect(fx.moduleRef.get(TicketNotificationConsumer)).toBeDefined();
  });

  it('2. **The existing NATS consumers still fire after the gRPC server was added**', async () => {
    // The regression the hybrid conversion actually risks.
    // Asserted by driving the handler and checking for a ROW, because a
    // consumer that was registered and does nothing looks identical to one that
    // was never registered at all.
    const controller = fx.moduleRef.get(NotificationsController);

    await controller.handleInAppNotification(
      {
        organizationId: ORG,
        type: NOTIFICATION_TYPES.quotaThreshold,
        audience: { kind: 'permission', permission: 'organization.update' },
        eventId: 'boot-check',
        title: 'AI budget 80% used',
        body: 'At 100%, questions route to your agents.',
        priority: NotificationPriority.NORMAL,
        occurredAt: new Date().toISOString(),
      },
      natsContext,
    );

    await expect(fx.prisma.notification.count()).resolves.toBe(1);
  });

  it('3. Subscribes to every subject Domain E owns AND to `ticket.*`', () => {
    // Reflected from the decorators rather than trusted to a comment: a
    // handler that lost its `@EventPattern` is a subject that silently stops
    // being consumed, which is precisely the bug hardening was about.
    const patterns = new Set<string>();

    for (const target of [
      NotificationsController,
      TicketNotificationConsumer,
    ]) {
      const prototype = target.prototype as unknown as Record<string, unknown>;

      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function') continue;

        const pattern: unknown = Reflect.getMetadata(
          'microservices:pattern',
          handler,
        );
        // Nest stores it as an array when a handler carries several.
        for (const value of Array.isArray(pattern) ? pattern : [pattern]) {
          if (typeof value === 'string') patterns.add(value);
        }
      }
    }

    expect([...patterns].sort(compareAlphabetically)).toEqual(
      [
        IN_APP_NOTIFICATION_PATTERN,
        NOTIFICATION_PATTERNS.sendEmail,
        NOTIFICATION_PATTERNS.sendSms,
        TICKET_PATTERNS.assigned,
        TICKET_PATTERNS.reassigned,
        TICKET_PATTERNS.unassigned,
        TICKET_PATTERNS.escalated,
        TICKET_PATTERNS.messageCreated,
        TICKET_PATTERNS.statusChanged,
      ].sort(compareAlphabetically),
    );
  });

  it('4. Does NOT subscribe to `ticket.created`', () => {
    // A deliberate silence, pinned so nobody adds it back: the highest-volume
    // event with the lowest information. Whoever created the ticket knows, and
    // nobody is assigned yet.
    const prototype = TicketNotificationConsumer.prototype as unknown as Record<
      string,
      unknown
    >;
    const patterns = Object.getOwnPropertyNames(prototype)
      .map((name) => prototype[name])
      .filter(
        (handler): handler is (...args: never[]) => unknown =>
          typeof handler === 'function',
      )
      // `flatMap`, not `map(…).flat()`: one pass, instead of building an
      // intermediate array of arrays purely to discard it.
      .flatMap(
        (handler) =>
          Reflect.getMetadata('microservices:pattern', handler) as unknown[],
      );

    expect(patterns).not.toContain(TICKET_PATTERNS.created);
  });

  it('5. PUBLISHES as well as consuming — the direction that did not exist', () => {
    // Before Domain E this service consumed events and published none, so it had
    // no NATS *client* at all. The socket relay needs one, and a publisher
    // resolved from a client that was never registered fails at runtime rather
    // than at boot — which means the first thing to notice would be a toast
    // that never arrives.
    fx.emitted.length = 0;

    fx.moduleRef.get(NotificationRealtimePublisher).publishRead({
      recipientId: RECIPIENT,
      notificationIds: [],
      change: 'read',
      unreadCount: 0,
    });

    expect(fx.emitted.map((entry) => entry.pattern)).toEqual([
      NOTIFICATION_REALTIME_PATTERNS.read,
    ]);
  });
});
