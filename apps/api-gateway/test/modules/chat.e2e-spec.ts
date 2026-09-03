import { of } from 'rxjs';
import { faker } from '@faker-js/faker';
import { TicketSource, TicketStatus } from '@synapsedesk/common';
import {
  TicketSource as ProtoTicketSource,
  TicketStatus as ProtoTicketStatus,
} from '@synapsedesk/grpc-proto';
import {
  API,
  E2eFixture,
  anonymousAgent,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { wireCreatedMessage, wirePage, wireTicket } from '../fixtures/wire';
import { StartConversationDto } from '../../src/modules/chat/dto/rest/chat.dto';

/**
 * Self-service chat — proving it is a WRAPPER, not a second implementation.
 *
 * Almost every assertion here is of the form "the chat route forwarded the same
 * request the tickets route would have". That is the only thing worth testing
 * about this module: it has no logic of its own, and the failure mode it exists
 * to prevent is somebody adding some.
 */
describe('Self-service chat at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const conversationId = faker.string.uuid();
  const start: StartConversationDto = {
    title: 'Cannot log in',
    message: 'It says bad password',
  };

  beforeAll(async () => {
    await flushTestRedis();
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  describe('POST /chat/conversations', () => {
    it('1. creates a ticket with source CHAT', async () => {
      fx.stubs.ticket.createTicket.mockReturnValue(
        of(wireTicket({ source: ProtoTicketSource.TICKET_SOURCE_CHAT })),
      );

      const res = await authenticatedAgent(fx.app, { permissionCodes: [] })
        .post(`${API}/chat/conversations`)
        .send(start);

      expect(res.status).toBe(201);
      expect(res.body.data.source).toBe(TicketSource.CHAT);
    });

    it('2. needs NO ticket.create permission', async () => {
      // Starting a conversation IS the product's entry point. Requiring a grant
      // would mean a customer needed an administrator before asking a question.
      // `POST /tickets` keeps its permission because it can author on somebody
      // else's behalf; this route cannot.
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      const res = await authenticatedAgent(fx.app, { permissionCodes: [] })
        .post(`${API}/chat/conversations`)
        .send(start);

      expect(res.status).toBe(201);
    });

    it('3. FORCES source=CHAT rather than accepting it from the body', async () => {
      // Otherwise a client could open a conversation that reports itself as
      // having arrived by email, and every source-based report would be wrong.
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      await authenticatedAgent(fx.app)
        .post(`${API}/chat/conversations`)
        .send(start);

      const [request] = fx.stubs.ticket.createTicket.mock.calls[0];
      expect(request.source).toBe(ProtoTicketSource.TICKET_SOURCE_CHAT);
    });

    it('4. REJECTS a client-supplied source', async () => {
      const res = await authenticatedAgent(fx.app)
        .post(`${API}/chat/conversations`)
        .send({ ...start, source: TicketSource.EMAIL });

      expect(res.status).toBe(400);
      expect(fx.stubs.ticket.createTicket).not.toHaveBeenCalled();
    });

    it('5. REJECTS a client-supplied authorId', async () => {
      // Raising a ticket on somebody else's behalf is an agent action, and this
      // is the end-user surface. Refused at the shape, so the only thing
      // standing between a chat client and impersonation is not a permission
      // check it cannot see.
      const res = await authenticatedAgent(fx.app)
        .post(`${API}/chat/conversations`)
        .send({ ...start, authorId: faker.string.uuid() });

      expect(res.status).toBe(400);
      expect(fx.stubs.ticket.createTicket).not.toHaveBeenCalled();
    });

    it('6. sends NO authorId, so the service defaults to the caller', async () => {
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      await authenticatedAgent(fx.app)
        .post(`${API}/chat/conversations`)
        .send(start);

      const [request] = fx.stubs.ticket.createTicket.mock.calls[0];
      expect(request.authorId).toBeFalsy();
    });

    it('7. maps `message` onto the ticket DESCRIPTION', async () => {
      // The end-user field name differs; the ticket field it lands in must not.
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      await authenticatedAgent(fx.app)
        .post(`${API}/chat/conversations`)
        .send(start);

      const [request] = fx.stubs.ticket.createTicket.mock.calls[0];
      expect(request.description).toBe('It says bad password');
      expect(request.title).toBe('Cannot log in');
    });

    it('8. produces a request IDENTICAL to POST /tickets but for the source', async () => {
      // Stated directly: "indistinguishable from a direct
      // POST /tickets except for that field".
      fx.stubs.ticket.createTicket.mockReturnValue(of(wireTicket()));

      await authenticatedAgent(fx.app)
        .post(`${API}/chat/conversations`)
        .send(start);
      const [viaChat] = fx.stubs.ticket.createTicket.mock.calls[0];

      fx.stubs.ticket.createTicket.mockClear();
      await authenticatedAgent(fx.app, { permissionCodes: ['ticket.create'] })
        .post(`${API}/tickets`)
        .send({ title: start.title, description: start.message });
      const [viaTickets] = fx.stubs.ticket.createTicket.mock.calls[0];

      expect({ ...viaChat, source: null }).toEqual({
        ...viaTickets,
        source: null,
      });
      expect(viaChat.source).toBe(ProtoTicketSource.TICKET_SOURCE_CHAT);
      expect(viaTickets.source).toBe(
        ProtoTicketSource.TICKET_SOURCE_UNSPECIFIED,
      );
    });
  });

  describe('GET /chat/conversations', () => {
    it('1. filters to source=CHAT and to the CALLER as author', async () => {
      // Pinning the author matters even though the service has a visibility
      // filter: that filter widens to the whole tenant for anyone holding
      // `ticket.read.all`, which is right for the queue at `/tickets` and wrong
      // for "my conversations".
      fx.stubs.ticket.listTickets.mockReturnValue(of(wirePage([])));

      await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      }).get(`${API}/chat/conversations`);

      const [request] = fx.stubs.ticket.listTickets.mock.calls[0];
      expect(request.source).toBe(ProtoTicketSource.TICKET_SOURCE_CHAT);
      expect(request.authorId).toBeTruthy();
    });

    it('2. never surfaces DELETED conversations', async () => {
      fx.stubs.ticket.listTickets.mockReturnValue(of(wirePage([])));

      await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.delete'],
      }).get(`${API}/chat/conversations?includeDeleted=true`);

      const [request] = fx.stubs.ticket.listTickets.mock.calls[0];
      expect(request.includeDeleted).toBe(false);
    });

    it('3. is readable with NO permissions', async () => {
      fx.stubs.ticket.listTickets.mockReturnValue(of(wirePage([wireTicket()])));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/chat/conversations`);

      expect(res.status).toBe(200);
    });
  });

  describe('POST /chat/conversations/:id/messages', () => {
    it('1. forwards to the SAME message write as /tickets', async () => {
      fx.stubs.message.createMessage.mockReturnValue(of(wireCreatedMessage()));

      await authenticatedAgent(fx.app)
        .post(`${API}/chat/conversations/${conversationId}/messages`)
        .send({ content: 'Any update?' });

      expect(fx.stubs.message.createMessage).toHaveBeenCalledTimes(1);
      const [request] = fx.stubs.message.createMessage.mock.calls[0];
      expect(request.ticketId).toBe(conversationId);
      expect(request.content).toBe('Any update?');
    });

    it('2. FORCES isInternalNote false even when asked for', async () => {
      // An end-user surface has no notion of an agent-only note. Forwarding the
      // flag would leave a permission check as the only thing stopping a chat
      // client from writing one — refused at the shape instead.
      fx.stubs.message.createMessage.mockReturnValue(of(wireCreatedMessage()));

      await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      })
        .post(`${API}/chat/conversations/${conversationId}/messages`)
        .send({ content: 'sneaky', isInternalNote: true });

      const [request] = fx.stubs.message.createMessage.mock.calls[0];
      expect(request.isInternalNote).toBe(false);
    });

    it('3. still forwards invokeAi — the point of a chat', async () => {
      fx.stubs.message.createMessage.mockReturnValue(of(wireCreatedMessage()));

      await authenticatedAgent(fx.app)
        .post(`${API}/chat/conversations/${conversationId}/messages`)
        .send({ content: 'How do I reset it?', invokeAi: true });

      const [request] = fx.stubs.message.createMessage.mock.calls[0];
      expect(request.invokeAi).toBe(true);
    });
  });

  describe('POST /chat/conversations/:id/escalate', () => {
    it('1. is a literal ALIAS — same RPC, same request', async () => {
      // Re-deriving the transition here would give chat its own
      // escalation semantics, and the first divergence would be a ticket that
      // escalated without an `escalated_at`.
      fx.stubs.ticket.escalateTicket.mockReturnValue(
        of(wireTicket({ status: ProtoTicketStatus.TICKET_STATUS_ESCALATED })),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).post(`${API}/chat/conversations/${conversationId}/escalate`);
      const [viaChat] = fx.stubs.ticket.escalateTicket.mock.calls[0];

      fx.stubs.ticket.escalateTicket.mockClear();
      await authenticatedAgent(fx.app, { permissionCodes: [] }).post(
        `${API}/tickets/${conversationId}/escalate`,
      );
      const [viaTickets] = fx.stubs.ticket.escalateTicket.mock.calls[0];

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(TicketStatus.ESCALATED);
      expect(viaChat).toEqual(viaTickets);
    });

    it('2. is available to an end user with NO permissions', async () => {
      // One-click hand-off to a human is the self-service product's core
      // affordance. A customer who needs a person cannot be made to wait for an
      // administrator to grant them the right to ask for one.
      fx.stubs.ticket.escalateTicket.mockReturnValue(of(wireTicket()));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).post(`${API}/chat/conversations/${conversationId}/escalate`);

      expect(res.status).toBe(200);
    });
  });

  describe('access and routing', () => {
    it('1. refuses an ANONYMOUS caller', async () => {
      const res = await anonymousAgent(fx.app)
        .post(`${API}/chat/conversations`)
        .send(start);

      expect(res.status).toBe(401);
    });

    it('2. rejects a NON-UUID conversation id', async () => {
      const res = await authenticatedAgent(fx.app).get(
        `${API}/chat/conversations/not-a-uuid`,
      );

      expect(res.status).toBe(400);
    });

    it('3. does not collide GET :id with GET :id/messages', async () => {
      fx.stubs.message.listMessages.mockReturnValue(
        of({ items: [], meta: wirePage([]).meta }),
      );

      await authenticatedAgent(fx.app).get(
        `${API}/chat/conversations/${conversationId}/messages`,
      );

      expect(fx.stubs.message.listMessages).toHaveBeenCalledTimes(1);
      expect(fx.stubs.ticket.getTicket).not.toHaveBeenCalled();
    });
  });
});
