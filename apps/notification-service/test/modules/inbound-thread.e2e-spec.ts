import { faker } from '@faker-js/faker';
import {
  NOTIFICATION_TYPES,
  NotificationChannel,
  NotificationResourceType,
} from '@synapsedesk/common';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { InboundThreadService } from '../../src/modules/feed/inbound-thread.service';

/**
 * The `In-Reply-To` fallback
 *
 * **A two-hop join, and the second hop is the tenant check.** A `Message-ID` is
 * a string a sender's client echoes back; it is not a credential, and anyone
 * who has ever received a notification from this system holds one. What stops
 * it addressing another tenant's ticket is that the join is scoped.
 */
describe('§31 §4 resolving a ticket from a Message-ID (e2e)', () => {
  let fx: E2eFixture;
  let threads: InboundThreadService;

  const ORG = faker.string.uuid();
  const OTHER_ORG = faker.string.uuid();
  const TICKET = faker.string.uuid();
  const MESSAGE_ID = '<notification-42@app.test>';

  /** A sent email notification about a ticket, as the write path records one. */
  const seedDelivery = async (
    options: {
      organizationId?: string;
      providerMessageId?: string;
      resourceType?: NotificationResourceType;
      resourceId?: string;
      channel?: NotificationChannel;
    } = {},
  ) => {
    const notification = await fx.prisma.notification.create({
      data: {
        organizationId: options.organizationId ?? ORG,
        recipientId: faker.string.uuid(),
        type: NOTIFICATION_TYPES.ticketAssigned,
        title: 'Ticket #42 assigned to you',
        resourceType: options.resourceType ?? NotificationResourceType.TICKET,
        resourceId: options.resourceId ?? TICKET,
      },
    });

    await fx.prisma.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        channel: options.channel ?? NotificationChannel.EMAIL,
        status: 'SENT',
        target: 'customer@acme.test',
        providerMessageId: options.providerMessageId ?? MESSAGE_ID,
      },
    });
  };

  const resolve = (providerMessageId: string, organizationId = ORG) =>
    threads.resolveTicketByMessageId({ providerMessageId, organizationId });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    threads = fx.moduleRef.get(InboundThreadService);
  }, 30_000);

  beforeEach(() => fx.reset());

  afterAll(() => fx.close());

  it('1. finds the ticket an emailed notification was about', async () => {
    await seedDelivery();

    await expect(resolve(MESSAGE_ID)).resolves.toEqual({ ticketId: TICKET });
  });

  it('2. **and never one belonging to another tenant**', async () => {
    // The isolation the doc's message sketch had no field for. Without the
    // scope, a `Message-ID` from one tenant's notification would thread mail
    // addressed to another into their ticket.
    await seedDelivery({ organizationId: OTHER_ORG });

    await expect(resolve(MESSAGE_ID, ORG)).resolves.toEqual({
      ticketId: undefined,
    });
  });

  it('3. an unknown Message-ID is absent, not an error', async () => {
    // The COMMON case: most inbound mail is not a reply to anything we sent.
    await expect(resolve('<nothing@elsewhere.test>')).resolves.toEqual({
      ticketId: undefined,
    });
  });

  it('4. a notification about something other than a ticket does not match', async () => {
    // There is nothing to thread into. Returning its `resource_id` would
    // append a customer's reply to a resource that is not a conversation.
    await seedDelivery({
      resourceType: NotificationResourceType.DOCUMENT,
      resourceId: faker.string.uuid(),
    });

    await expect(resolve(MESSAGE_ID)).resolves.toEqual({
      ticketId: undefined,
    });
  });

  it('5. and neither does a delivery on another channel', async () => {
    // An SMS carries no `Message-ID` a mail client could echo, so a match here
    // would mean the column holds something other than what it claims.
    await seedDelivery({ channel: NotificationChannel.SMS });

    await expect(resolve(MESSAGE_ID)).resolves.toEqual({
      ticketId: undefined,
    });
  });

  it('6. an empty id is answered, not queried', async () => {
    // Guarded before Prisma: an undefined `where` raises a validation error the
    // caller sees as UNKNOWN, where "no match" is the honest answer.
    await expect(resolve('')).resolves.toEqual({ ticketId: undefined });
    await expect(resolve(MESSAGE_ID, '')).resolves.toEqual({
      ticketId: undefined,
    });
  });

  it('**and the newest delivery wins when a Message-ID repeats**', async () => {
    // The column is not unique. A stale duplicate must not outrank a current
    // one, or a reply threads onto a ticket the sender stopped discussing.
    const newer = faker.string.uuid();

    await seedDelivery({ resourceId: faker.string.uuid() });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await seedDelivery({ resourceId: newer });

    await expect(resolve(MESSAGE_ID)).resolves.toEqual({ ticketId: newer });
  });
});
