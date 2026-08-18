import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { ConfigService } from '@nestjs/config';
import {
  OrgStatus as ProtoOrgStatus,
  TicketStatus as ProtoTicketStatus,
} from '@synapsedesk/grpc-proto';
import {
  buildInboundAddress,
  buildTicketReplyToken,
  generateInboundToken,
} from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { timestamp, wireCreatedMessage } from '../fixtures/wire';
import {
  plainEmail,
  signPayload,
  INBOUND_DOMAIN,
} from '../fixtures/inbound-email';

/**
 * Tenant → sender → thread
 *
 * **Test 7 is the one that matters** and it is asserted twice here: a forged
 * reply token must not append to the ticket it names. Everything else in this
 * file fails visibly; that one lets a customer read and write another's support
 * thread by editing an address, and it looks exactly like ordinary email
 * working.
 */
describe('Inbound email routing (e2e)', () => {
  let fx: E2eFixture;
  let secret: string;

  const organizationId = faker.string.uuid();
  const senderId = faker.string.uuid();
  const tenantToken = generateInboundToken();

  const post = (payload: Record<string, unknown>) => {
    const { body, signature } = signPayload(payload, secret);

    return request(fx.app.getHttpServer())
      .post('/api/v1/webhooks/email/inbound')
      .set('content-type', 'application/json')
      .set('x-inbound-signature', signature)
      .send(body);
  };

  /** The happy path: a known tenant and a permitted sender. */
  const resolvable = () => {
    fx.stubs.organization.resolveOrgByInboundToken.mockReturnValue(
      of({ organizationId, status: ProtoOrgStatus.ORG_STATUS_ACTIVE }),
    );
    fx.stubs.user.resolveInboundSender.mockReturnValue(
      of({ userId: senderId, created: false }),
    );
  };

  const wireTicket = (overrides: Record<string, unknown> = {}) => ({
    id: faker.string.uuid(),
    ticketNumber: 4211,
    organizationId,
    authorId: senderId,
    source: 3,
    status: 2,
    priority: 2,
    title: 'The printer is on fire',
    description: 'It really is',
    currentDepartmentId: faker.string.uuid(),
    createdAt: timestamp(),
    updatedAt: timestamp(),
    ...overrides,
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    secret = fx.app
      .get(ConfigService)
      .getOrThrow<string>('INBOUND_EMAIL_SECRET');
  }, 30_000);

  beforeEach(() => jest.clearAllMocks());

  afterAll(() => fx.close());

  // ---------------------------------------------------------------- tenant

  describe('the tenant comes from the address, never the sender', () => {
    it('an unknown token is dropped with a 200 and no sender lookup', async () => {
      fx.stubs.organization.resolveOrgByInboundToken.mockReturnValue(
        of({ organizationId: undefined, status: 0 }),
      );

      const response = await post(
        plainEmail({ to: buildInboundAddress(INBOUND_DOMAIN, tenantToken) }),
      ).expect(200);

      expect(response.body.data.outcome).toBe('unroutable_address');
      // **The order is the security property**. Resolving the
      // sender first would mean querying it unscoped.
      expect(fx.stubs.user.resolveInboundSender).not.toHaveBeenCalled();
      expect(fx.stubs.ticket.createTicket).not.toHaveBeenCalled();
    });

    it('**a suspended tenant takes no mail**', async () => {
      // The global lifecycle interceptor reads the status off the CALLER's
      // identity, and this route has none — the tenant comes from the address.
      // So the gate is applied here instead, or a suspended tenant quietly
      // grows a queue of tickets nobody is paying for and nobody can see.
      fx.stubs.organization.resolveOrgByInboundToken.mockReturnValue(
        of({
          organizationId,
          status: ProtoOrgStatus.ORG_STATUS_SUSPENDED_PAST_DUE,
        }),
      );

      const response = await post(
        plainEmail({ to: buildInboundAddress(INBOUND_DOMAIN, tenantToken) }),
      ).expect(200);

      expect(response.body.data.outcome).toBe('tenant_inactive');
      expect(fx.stubs.user.resolveInboundSender).not.toHaveBeenCalled();
      expect(fx.stubs.ticket.createTicket).not.toHaveBeenCalled();
    });

    it('and an address that is not ours at all never reaches auth-service', async () => {
      const response = await post(
        plainEmail({ to: `hello@${INBOUND_DOMAIN}` }),
      ).expect(200);

      expect(response.body.data.outcome).toBe('unroutable_address');
      expect(
        fx.stubs.organization.resolveOrgByInboundToken,
      ).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- sender

  describe('the sender is resolved within that tenant', () => {
    it('5. **a refused sender creates no ticket**', async () => {
      fx.stubs.organization.resolveOrgByInboundToken.mockReturnValue(
        of({ organizationId, status: ProtoOrgStatus.ORG_STATUS_ACTIVE }),
      );
      fx.stubs.user.resolveInboundSender.mockReturnValue(
        of({ userId: undefined, created: false }),
      );

      const response = await post(
        plainEmail({ to: buildInboundAddress(INBOUND_DOMAIN, tenantToken) }),
      ).expect(200);

      expect(response.body.data.outcome).toBe('sender_not_permitted');
      expect(fx.stubs.ticket.createTicket).not.toHaveBeenCalled();
    });

    it('**and the tenant it is resolved in is the ADDRESSED one**', async () => {
      // The argument the RPC's shape exists for: the organization travels from
      // the token, never from the sender's domain.
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      await post(
        plainEmail({ to: buildInboundAddress(INBOUND_DOMAIN, tenantToken) }),
      ).expect(200);

      const [[sent]] = fx.stubs.user.resolveInboundSender.mock.calls;

      expect(sent.organizationId).toBe(organizationId);
    });
  });

  // ---------------------------------------------------------------- thread

  describe('threading', () => {
    it('1. a first message creates a ticket with `source = EMAIL`', async () => {
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      const response = await post(
        plainEmail({ to: buildInboundAddress(INBOUND_DOMAIN, tenantToken) }),
      ).expect(200);

      expect(response.body.data.outcome).toBe('ticket_created');

      const [[sent]] = fx.stubs.ticket.createTicket.mock.calls;

      // 3 is TICKET_SOURCE_EMAIL — the wire enum, not the DTO string.
      expect(sent.source).toBe(3);
      expect(sent.authorId).toBe(senderId);
      expect(sent.inboundMessageId).toBeTruthy();
    });

    it('6. **a valid reply token appends to that ticket**', async () => {
      resolvable();
      fx.stubs.ticket.getTicketByNumber.mockReturnValue(of(wireTicket()));
      fx.stubs.message.createMessage.mockReturnValue(of(wireCreatedMessage()));

      const token = buildTicketReplyToken(organizationId, 4211, secret);

      const response = await post(
        plainEmail({
          to: buildInboundAddress(INBOUND_DOMAIN, tenantToken, token),
        }),
      ).expect(200);

      expect(response.body.data.outcome).toBe('message_appended');
      expect(fx.stubs.ticket.createTicket).not.toHaveBeenCalled();

      const [[sent]] = fx.stubs.message.createMessage.mock.calls;

      // A customer's reply is customer-visible by definition. An internal note
      // reaching one is the leak found in the realtime fan-out.
      expect(sent.isInternalNote).toBe(false);
    });

    it('7. **a FORGED ticket token opens a new ticket, never appends**', async () => {
      // The whole purpose of the HMAC. The number is legible in the address,
      // and the neighbouring tickets belong to other customers.
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      const legitimate = buildTicketReplyToken(organizationId, 4211, secret);
      const forged = `${(4212).toString(36)}-${legitimate.split('-')[1]}`;

      const response = await post(
        plainEmail({
          to: buildInboundAddress(INBOUND_DOMAIN, tenantToken, forged),
        }),
      ).expect(200);

      expect(response.body.data.outcome).toBe('ticket_created');
      expect(fx.stubs.ticket.getTicketByNumber).not.toHaveBeenCalled();
      expect(fx.stubs.message.createMessage).not.toHaveBeenCalled();
    });

    it('11. **and a token minted for ANOTHER tenant does not thread**', async () => {
      // Ticket numbers repeat across tenants, so without the tenant inside the
      // MAC this address would append to a stranger's #4211.
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      const foreign = buildTicketReplyToken(faker.string.uuid(), 4211, secret);

      const response = await post(
        plainEmail({
          to: buildInboundAddress(INBOUND_DOMAIN, tenantToken, foreign),
        }),
      ).expect(200);

      expect(response.body.data.outcome).toBe('ticket_created');
      expect(fx.stubs.message.createMessage).not.toHaveBeenCalled();
    });

    it('9. **a reply to a CLOSED ticket reopens it through the transition**', async () => {
      resolvable();
      // 6 is TICKET_STATUS_CLOSED on the wire. Spelled as the enum rather than
      // the number, because 5 is RESOLVED and the two are one digit apart.
      fx.stubs.ticket.getTicketByNumber.mockReturnValue(
        of(wireTicket({ status: ProtoTicketStatus.TICKET_STATUS_CLOSED })),
      );
      fx.stubs.ticket.reopenTicket.mockReturnValue(of(wireTicket()));
      fx.stubs.message.createMessage.mockReturnValue(of(wireCreatedMessage()));

      const token = buildTicketReplyToken(organizationId, 4211, secret);

      await post(
        plainEmail({
          to: buildInboundAddress(INBOUND_DOMAIN, tenantToken, token),
        }),
      ).expect(200);

      // Through `ReopenTicket`, which runs the transition table — never a
      // direct status write.
      expect(fx.stubs.ticket.reopenTicket).toHaveBeenCalledTimes(1);
      expect(fx.stubs.ticket.changeTicketStatus).not.toHaveBeenCalled();
      expect(fx.stubs.message.createMessage).toHaveBeenCalledTimes(1);
    });

    it('a verified token for a ticket that no longer exists opens a new one', async () => {
      // The safe direction: discarding a customer's message is worse than a
      // duplicate ticket.
      resolvable();
      fx.stubs.ticket.getTicketByNumber.mockReturnValue(
        throwError(() => ({ code: GrpcStatus.NOT_FOUND })),
      );
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      const token = buildTicketReplyToken(organizationId, 4211, secret);

      const response = await post(
        plainEmail({
          to: buildInboundAddress(INBOUND_DOMAIN, tenantToken, token),
        }),
      ).expect(200);

      expect(response.body.data.outcome).toBe('ticket_created');
    });
  });

  describe('8. the `In-Reply-To` fallback', () => {
    const seenTicketId = faker.string.uuid();

    it('**a reply with no token but a matching Message-ID threads correctly**', async () => {
      // Someone answering a forwarded copy, or writing to the bare support
      // address about an existing issue. Without this every such reply opens a
      // duplicate ticket.
      resolvable();
      fx.stubs.notification.resolveTicketByMessageId.mockReturnValue(
        of({ ticketId: seenTicketId }),
      );
      fx.stubs.ticket.getTicket.mockReturnValue(
        of(wireTicket({ id: seenTicketId })),
      );
      fx.stubs.message.createMessage.mockReturnValue(of(wireCreatedMessage()));

      const response = await post(
        plainEmail({
          to: buildInboundAddress(INBOUND_DOMAIN, tenantToken),
          inReplyTo: '<notification-42@app.test>',
        }),
      ).expect(200);

      expect(response.body.data.outcome).toBe('message_appended');
      expect(fx.stubs.ticket.createTicket).not.toHaveBeenCalled();

      // **Scoped by the ADDRESSED tenant**, not by the header alone. A
      // `Message-ID` lifted from another tenant's notification must not resolve
      // into theirs.
      const [[sent]] =
        fx.stubs.notification.resolveTicketByMessageId.mock.calls;

      expect(sent.organizationId).toBe(organizationId);
    });

    it('falls back to `References`, newest first', async () => {
      resolvable();
      fx.stubs.notification.resolveTicketByMessageId
        .mockReturnValueOnce(of({ ticketId: undefined }))
        .mockReturnValueOnce(of({ ticketId: seenTicketId }));
      fx.stubs.ticket.getTicket.mockReturnValue(
        of(wireTicket({ id: seenTicketId })),
      );
      fx.stubs.message.createMessage.mockReturnValue(of(wireCreatedMessage()));

      await post(
        plainEmail({
          to: buildInboundAddress(INBOUND_DOMAIN, tenantToken),
          references: ['<oldest@app.test>', '<newest@app.test>'],
        }),
      ).expect(200);

      // The LAST entry is the message being answered, so it is tried first.
      const tried =
        fx.stubs.notification.resolveTicketByMessageId.mock.calls.map(
          ([request]) => request.providerMessageId,
        );

      expect(tried[0]).toBe('<newest@app.test>');
    });

    it('**and a FORGED token does not fall through to the header**', async () => {
      // The header is controlled by the same sender as the address. Falling
      // through would hand back exactly the threading the MAC just refused.
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      const legitimate = buildTicketReplyToken(organizationId, 4211, secret);
      const forged = `${(4212).toString(36)}-${legitimate.split('-')[1]}`;

      const response = await post(
        plainEmail({
          to: buildInboundAddress(INBOUND_DOMAIN, tenantToken, forged),
          inReplyTo: '<notification-42@app.test>',
        }),
      ).expect(200);

      expect(response.body.data.outcome).toBe('ticket_created');
      expect(
        fx.stubs.notification.resolveTicketByMessageId,
      ).not.toHaveBeenCalled();
    });

    it('no match opens a new ticket', async () => {
      resolvable();
      fx.stubs.notification.resolveTicketByMessageId.mockReturnValue(
        of({ ticketId: undefined }),
      );
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      const response = await post(
        plainEmail({
          to: buildInboundAddress(INBOUND_DOMAIN, tenantToken),
          inReplyTo: '<unknown@elsewhere.test>',
        }),
      ).expect(200);

      expect(response.body.data.outcome).toBe('ticket_created');
    });
  });

  // ---------------------------------------------------------------- dedup

  describe('redelivery', () => {
    it('4. **a duplicate is a 200 and a stop**', async () => {
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(
        throwError(() => ({ code: GrpcStatus.ALREADY_EXISTS })),
      );

      const response = await post(
        plainEmail({ to: buildInboundAddress(INBOUND_DOMAIN, tenantToken) }),
      ).expect(200);

      expect(response.body.data.outcome).toBe('duplicate');
    });

    it('5. **a message with no `Message-ID` dedups across a REAL retry**', async () => {
      // The earlier version of this test sent the payload ONCE and asserted a
      // key was built. That passes for a key that changes on every attempt —
      // which is what the first implementation had, because it hashed the
      // Worker's `receivedAt`.
      //
      // A retry is a re-run of the Worker: same message, NEW `receivedAt`. The
      // key must be identical across the two, or the redelivery opens a second
      // ticket.
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      const message = {
        to: buildInboundAddress(INBOUND_DOMAIN, tenantToken),
        messageId: undefined,
        date: 'Tue, 11 Aug 2026 09:14:00 +0000',
      };

      await post(
        plainEmail({ ...message, receivedAt: '2026-08-11T09:14:01.000Z' }),
      ).expect(200);
      await post(
        plainEmail({ ...message, receivedAt: '2026-08-11T09:20:33.000Z' }),
      ).expect(200);

      const keys = fx.stubs.ticket.createTicket.mock.calls.map(
        ([request]) => request.inboundMessageId,
      );

      expect(keys[0]).toContain('synthesized:');
      expect(keys[1]).toBe(keys[0]);
    });

    it('**and two DIFFERENT messages in the same second stay distinct**', async () => {
      // The over-correction. A key coarse enough to merge distinct mail loses a
      // customer's message, which is worse than the duplicate it avoids — so
      // the body is in the digest.
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      const shared = {
        to: buildInboundAddress(INBOUND_DOMAIN, tenantToken),
        messageId: undefined,
        subject: 'Printer',
        date: 'Tue, 11 Aug 2026 09:14:00 +0000',
        receivedAt: '2026-08-11T09:14:00.000Z',
      };

      await post(plainEmail({ ...shared, text: 'first thought' })).expect(200);
      await post(plainEmail({ ...shared, text: 'second thought' })).expect(200);

      const keys = fx.stubs.ticket.createTicket.mock.calls.map(
        ([request]) => request.inboundMessageId,
      );

      expect(keys[1]).not.toBe(keys[0]);
    });

    it('**and an infrastructure failure is NOT a 200**', async () => {
      // The distinction "always 200" does not cover. A deliberate
      // drop must not be retried; a service being down must be, or the mail is
      // lost on the one delivery that could have recovered it.
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(
        throwError(() => ({ code: GrpcStatus.UNAVAILABLE })),
      );

      const response = await post(
        plainEmail({ to: buildInboundAddress(INBOUND_DOMAIN, tenantToken) }),
      );

      expect(response.status).toBeGreaterThanOrEqual(500);
    });
  });

  describe('the recorded Worker payloads', () => {
    // These are the shapes the Worker emits, run through the real
    // endpoint — the closest this suite gets to the mail transport without one.
    const PAYLOADS = join(__dirname, '../fixtures/inbound-email/payloads');

    const fixture = (name: string) =>
      JSON.parse(readFileSync(join(PAYLOADS, name), 'utf8')) as Record<
        string,
        unknown
      >;

    /** Re-addressed to the tenant this suite resolves, keeping every other field. */
    const addressedHere = (name: string, ticketToken?: string) => ({
      ...fixture(name),
      to: buildInboundAddress(INBOUND_DOMAIN, tenantToken, ticketToken),
    });

    it('a plain reply becomes a ticket', async () => {
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      const response = await post(addressedHere('plain-reply.json')).expect(
        200,
      );

      expect(response.body.data.outcome).toBe('ticket_created');
    });

    it('an HTML-only message is stored as readable text', async () => {
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      await post(addressedHere('html-only.json')).expect(200);

      const [[sent]] = fx.stubs.ticket.createTicket.mock.calls;

      expect(sent.description).toBe(
        'The invoice total looks wrong.\nSecond paragraph.',
      );
      expect(sent.description).not.toContain('<p>');
    });

    it('**an auto-responder is dropped and answered with silence**', async () => {
      // Both guards at once: an unroutable address AND the headers that say a
      // machine sent it. The drop is logged; no reply is published.
      fx.stubs.organization.resolveOrgByInboundToken.mockReturnValue(
        of({ organizationId: undefined, status: 0 }),
      );

      const response = await post(addressedHere('auto-responder.json')).expect(
        200,
      );

      expect(response.body.data.outcome).toBe('unroutable_address');
    });

    it('a Gmail-quoted reply threads and keeps only the new text', async () => {
      resolvable();
      fx.stubs.ticket.getTicketByNumber.mockReturnValue(of(wireTicket()));
      fx.stubs.message.createMessage.mockReturnValue(of(wireCreatedMessage()));

      const token = buildTicketReplyToken(organizationId, 4211, secret);

      const response = await post(
        addressedHere('quoted-gmail.json', token),
      ).expect(200);

      expect(response.body.data.outcome).toBe('message_appended');

      const [[sent]] = fx.stubs.message.createMessage.mock.calls;

      expect(sent.content).toBe('Yes, that fixed it. Thanks!');
    });

    it('and a dropped attachment is named in the ticket body', async () => {
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      await post(addressedHere('with-attachment.json')).expect(200);

      const [[sent]] = fx.stubs.ticket.createTicket.mock.calls;

      expect(sent.description).toContain('screenshot.png');
      expect(sent.description).toContain('log.txt');
    });
  });

  // ---------------------------------------------------------------- body

  describe('what gets stored', () => {
    it('10. quoted history is stripped before the RPC', async () => {
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      await post(
        plainEmail({
          to: buildInboundAddress(INBOUND_DOMAIN, tenantToken),
          text: [
            'It is fixed now, thanks.',
            '',
            'On Tue, 11 Aug 2026 at 09:14, Support <support@app.test> wrote:',
            '> Have you tried turning it off and on again?',
          ].join('\n'),
        }),
      ).expect(200);

      const [[sent]] = fx.stubs.ticket.createTicket.mock.calls;

      expect(sent.description).toBe('It is fixed now, thanks.');
      expect(sent.description).not.toContain('turning it off');
    });

    it('and dropped attachments are named in the body, not silently lost', async () => {
      resolvable();
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      await post(
        plainEmail({
          to: buildInboundAddress(INBOUND_DOMAIN, tenantToken),
          droppedAttachments: ['screenshot.png'],
        }),
      ).expect(200);

      const [[sent]] = fx.stubs.ticket.createTicket.mock.calls;

      expect(sent.description).toContain('screenshot.png');
    });
  });
});
