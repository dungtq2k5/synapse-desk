import { TicketPriority, TicketSource } from '@synapsedesk/grpc-proto';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import {
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
  createTestMessage,
} from '../utils';
import { buildTenant, createTicket, TenantFixture } from '../factories';
import { TicketsService } from '../../src/modules/tickets/tickets.service';
import { MessagesService } from '../../src/modules/messages/messages.service';

/**
 * Inbound-email idempotency — 31-doc §6.2, 32-doc §4.3.
 *
 * **The transactional property is the point, not the uniqueness.** A unique
 * index alone makes a redelivery fail. Writing the row in the SAME transaction
 * as the ticket is what makes a *failed* delivery retryable: recorded
 * separately, a request that inserted the dedup row and then failed would make
 * the provider's retry a silent no-op — the mail lost on the one delivery that
 * could still have recovered it.
 */
describe('§31 §6.2 inbound email dedup (e2e)', () => {
  let fx: E2eFixture;
  let tickets: TicketsService;
  let messages: MessagesService;
  let tenant: TenantFixture;

  const caller = (t = tenant) =>
    memberContext({ id: t.userId, organizationId: t.organizationId });

  const fromEmail = (inboundMessageId: string, title = 'From email') =>
    tickets.createTicket(
      {
        title,
        description: 'The printer is on fire',
        source: TicketSource.TICKET_SOURCE_EMAIL,
        priority: TicketPriority.TICKET_PRIORITY_MEDIUM,
        inboundMessageId,
      },
      caller(),
    );

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    tickets = fx.moduleRef.get(TicketsService);
    messages = fx.moduleRef.get(MessagesService);
  }, 30_000);

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  it('**an emailed ticket with no stated priority lands MEDIUM**', async () => {
    // The gateway sends UNSPECIFIED deliberately — no mail header carries a
    // priority, and reading one off the subject would let the sender set it.
    // That makes THIS default the triage rule for every emailed ticket, so it
    // is asserted here rather than assumed.
    const ticket = await tickets.createTicket(
      {
        title: 'From email',
        description: 'The printer is on fire',
        source: TicketSource.TICKET_SOURCE_EMAIL,
        priority: TicketPriority.TICKET_PRIORITY_UNSPECIFIED,
        inboundMessageId: '<unset-priority@mail.test>',
      },
      caller(),
    );

    const row = await fx.prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { priority: true },
    });

    expect(row?.priority).toBe('MEDIUM');
  });

  it('1. a first delivery creates the ticket and records the message', async () => {
    const ticket = await fromEmail('<first@mail.test>');

    const row = await fx.prisma.inboundEmail.findFirst({
      where: { messageId: '<first@mail.test>' },
    });

    expect(row?.ticketId).toBe(ticket.id);
    expect(row?.organizationId).toBe(tenant.organizationId);
  });

  it('2. **a redelivery is ALREADY_EXISTS and creates no second ticket**', async () => {
    await fromEmail('<retry@mail.test>');

    await expectRpc(fromEmail('<retry@mail.test>'), GrpcStatus.ALREADY_EXISTS);

    expect(
      await fx.prisma.ticket.count({
        where: { organizationId: tenant.organizationId },
      }),
    ).toBe(1);
  });

  it('3. **two tenants may receive the same `Message-ID`**', async () => {
    // A customer CCs both, or a mailing list fans out. A GLOBAL unique
    // constraint would drop the second tenant's copy silently — one tenant's
    // mail disappearing because of another tenant's traffic.
    await fromEmail('<shared@mail.test>');

    const other = buildTenant();
    await tickets.createTicket(
      {
        title: 'Other tenant',
        description: 'Same message id',
        source: TicketSource.TICKET_SOURCE_EMAIL,
        priority: TicketPriority.TICKET_PRIORITY_MEDIUM,
        inboundMessageId: '<shared@mail.test>',
      },
      caller(other),
    );

    expect(
      await fx.prisma.inboundEmail.count({
        where: { messageId: '<shared@mail.test>' },
      }),
    ).toBe(2);
  });

  it('4. **a failed ticket write leaves NO dedup row** — the retry must work', async () => {
    // The transactional half, and the reason this is not two statements. A row
    // surviving a failed insert would make the provider's retry see it,
    // conclude the work was done, and return success having created nothing.
    const tooLong = 'x'.repeat(5000);

    await expect(
      tickets.createTicket(
        {
          title: tooLong,
          description: 'doomed',
          source: TicketSource.TICKET_SOURCE_EMAIL,
          priority: TicketPriority.TICKET_PRIORITY_MEDIUM,
          inboundMessageId: '<doomed@mail.test>',
        },
        caller(),
      ),
    ).rejects.toBeDefined();

    expect(
      await fx.prisma.inboundEmail.count({
        where: { messageId: '<doomed@mail.test>' },
      }),
    ).toBe(0);
  });

  it('5. a ticket from any other transport writes no row at all', async () => {
    await tickets.createTicket(
      {
        title: 'From the web',
        description: 'No message id',
        source: TicketSource.TICKET_SOURCE_WEB,
        priority: TicketPriority.TICKET_PRIORITY_MEDIUM,
      },
      caller(),
    );

    expect(await fx.prisma.inboundEmail.count()).toBe(0);
  });

  it('6. **a redelivered REPLY appends nothing twice**', async () => {
    const ticket = await createTicket(fx.prisma, tenant);

    await createTestMessage(
      messages,
      {
        ticketId: ticket.id,
        content: 'A reply by email',
        isInternalNote: false,
        invokeAi: false,
        inboundMessageId: '<reply@mail.test>',
      },
      caller(),
    );

    await expectRpc(
      createTestMessage(
        messages,
        {
          ticketId: ticket.id,
          content: 'A reply by email',
          isInternalNote: false,
          invokeAi: false,
          inboundMessageId: '<reply@mail.test>',
        },
        caller(),
      ),
      GrpcStatus.ALREADY_EXISTS,
    );

    expect(
      await fx.prisma.ticketMessage.count({ where: { ticketId: ticket.id } }),
    ).toBe(1);
  });
});
