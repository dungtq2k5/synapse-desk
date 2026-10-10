import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  REDACTED_MESSAGE_PLACEHOLDER,
  SupersededReason,
  TICKET_PATTERNS,
  ticketMessageGroupKey,
} from '@synapsedesk/common';
import {
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
  pageRequest,
  createTestMessage,
} from '../utils';
import {
  buildTenant,
  createAiMessage,
  createAttachment,
  createMessage,
  createTicket,
  TenantFixture,
} from '../factories';
import { MessagesService } from '../../src/modules/messages/messages.service';
import { TicketEventPublisher } from '../../src/modules/events/ticket-event.publisher';
import { RagClientService } from '../../src/modules/ai-client/rag-client.service';
import { StorageReferenceService } from '../../src/modules/storage-client/storage-reference.service';
import { LedgerClientService } from '../../src/modules/ai-client/ledger-client.service';

describe('Ticket messages & attachments (e2e)', () => {
  let fx: E2eFixture;
  let messages: MessagesService;
  let events: TicketEventPublisher;
  let rag: RagClientService;

  let publish: jest.SpyInstance;
  let isAvailable: jest.SpyInstance;
  let generateReplyDraft: jest.SpyInstance;

  let tenant: TenantFixture;

  /** The ticket's author: an end user, no permissions at all. */
  const author = (t = tenant) =>
    memberContext({ id: t.userId, organizationId: t.organizationId });

  /** An agent: queue access, so internal notes are visible. */
  const agent = (t = tenant) =>
    memberContext({ id: t.agentId, organizationId: t.organizationId }, [
      'ticket.read.all',
    ]);

  /** An agent who may also redact. */
  const moderator = (t = tenant) =>
    memberContext({ id: t.agentId, organizationId: t.organizationId }, [
      'ticket.read.all',
      'ticket.message.moderate',
    ]);

  const listRequest = (ticketId: string) => ({
    ticketId,
    page: pageRequest(),
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    messages = fx.moduleRef.get(MessagesService);
    events = fx.moduleRef.get(TicketEventPublisher);
    rag = fx.moduleRef.get(RagClientService);

    publish = jest.spyOn(events, 'publish').mockImplementation(() => {});

    // Spied once and RE-STATED every test below. `clearAllMocks` resets call
    // records but keeps implementations, so a suite that mocked availability to
    // true would leak it into every later test — including the one asserting
    // the opposite.
    isAvailable = jest.spyOn(rag, 'isAvailable', 'get');
    generateReplyDraft = jest.spyOn(rag, 'generateReplyDraft');
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();

    // The real default in .env.test: RAG_SERVICE_URL is unset, so rag-service
    // is unavailable unless a test says otherwise.
    isAvailable.mockReturnValue(false);
    generateReplyDraft.mockRejectedValue(
      new Error('rag-service is not configured'),
    );

    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  // -------------------------------------------------------- internal notes

  describe('internal note visibility', () => {
    it('1. strips notes from a NON-AGENT thread fetch', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      await createMessage(fx.prisma, ticket.id, { content: 'Public reply' });
      await createMessage(fx.prisma, ticket.id, {
        content: 'Watch this one, possible refund abuse',
        isInternalNote: true,
      });

      const { items } = await messages.listMessages(
        listRequest(ticket.id),
        author(),
      );

      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('Public reply');
    });

    it('2. shows notes to an AGENT', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      await createMessage(fx.prisma, ticket.id);
      await createMessage(fx.prisma, ticket.id, { isInternalNote: true });

      const { items } = await messages.listMessages(
        listRequest(ticket.id),
        agent(),
      );

      expect(items).toHaveLength(2);
    });

    it('3. excludes notes from the non-agent COUNT, not just the rows', async () => {
      // The test that matters: a filter applied at serialization
      // leaves the count intact, and `totalItems` would then tell an end user
      // exactly how many notes exist about their ticket — the notes' existence
      // leaked through the pagination meta while their content stayed hidden.
      const ticket = await createTicket(fx.prisma, tenant);
      await createMessage(fx.prisma, ticket.id);
      for (let i = 0; i < 4; i++) {
        await createMessage(fx.prisma, ticket.id, { isInternalNote: true });
      }

      const { meta } = await messages.listMessages(
        listRequest(ticket.id),
        author(),
      );

      expect(meta!.totalItems).toBe(1);
    });

    it('4. hides a note from a non-agent fetching it DIRECTLY by id', async () => {
      // The list filter undone by a different route would be no filter at all.
      const ticket = await createTicket(fx.prisma, tenant);
      const note = await createMessage(fx.prisma, ticket.id, {
        isInternalNote: true,
        senderId: tenant.agentId,
      });

      await expectRpc(
        messages.updateMessage(
          { ticketId: ticket.id, messageId: note.id, content: 'edited' },
          author(),
        ),
        status.NOT_FOUND,
      );
    });

    it('5. REFUSES a non-agent posting an internal note', async () => {
      // Otherwise the author would create a message invisible to themselves.
      const ticket = await createTicket(fx.prisma, tenant);

      await expectRpc(
        createTestMessage(
          messages,
          {
            ticketId: ticket.id,
            content: 'sneaky',
            isInternalNote: true,
            invokeAi: false,
          },
          author(),
        ),
        status.PERMISSION_DENIED,
      );
    });
  });

  // --------------------------------------------------------------- create

  describe('searchTerm', () => {
    it('1. **filters on `content`, case-insensitively, and the COUNT agrees**', async () => {
      // `?searchTerm=` was on `ListMessagesQueryDto` and honoured by nobody:
      // an agent narrowing a long thread got the whole thread back and read it
      // as "nothing else matched" (known-gaps #6).
      //
      // `totalItems` is asserted because `listMessages` builds ONE `where` and
      // hands it to both `findMany` and `count` — a filter applied to the rows
      // alone would leave the meta describing a different query.
      const ticket = await createTicket(fx.prisma, tenant);
      await createMessage(fx.prisma, ticket.id, {
        content: 'Please issue a REFUND for order 12',
      });
      await createMessage(fx.prisma, ticket.id, {
        content: 'Shipping address updated',
      });

      const { items, meta } = await messages.listMessages(
        {
          ticketId: ticket.id,
          // Lower case against upper-case content: the filter is
          // `mode: 'insensitive'`, and a caller does not know how the text was
          // typed.
          page: pageRequest({ searchTerm: 'refund' }),
        },
        agent(),
      );

      expect(items).toHaveLength(1);
      expect(items[0].content).toContain('REFUND');
      expect(meta!.totalItems).toBe(1);
    });

    it('2. **composes with the internal-note scope rather than replacing it**', async () => {
      // The failure worth pre-empting: a `where` rebuilt around the search term
      // would drop `internalNoteScope`, and a non-agent searching a thread
      // would be handed the agent-only notes that matched. Search is a filter
      // ON TOP of the visibility boundary, never instead of it.
      const ticket = await createTicket(fx.prisma, tenant);
      await createMessage(fx.prisma, ticket.id, {
        content: 'Refund requested by the customer',
      });
      await createMessage(fx.prisma, ticket.id, {
        content: 'Refund abuse suspected on this account',
        isInternalNote: true,
      });

      const asAuthor = await messages.listMessages(
        { ticketId: ticket.id, page: pageRequest({ searchTerm: 'refund' }) },
        author(),
      );
      const asAgent = await messages.listMessages(
        { ticketId: ticket.id, page: pageRequest({ searchTerm: 'refund' }) },
        agent(),
      );

      expect(asAuthor.items).toHaveLength(1);
      expect(asAuthor.items[0].content).not.toContain('abuse');
      expect(asAuthor.meta!.totalItems).toBe(1);

      // Both matched the term; only one caller may see both.
      expect(asAgent.items).toHaveLength(2);
    });

    it('3. a BLANK term is not a filter', async () => {
      // `toSearchFilter` returns `undefined` for blank input, so an unfiltered
      // list stays index-friendly instead of becoming a full-table `contains`
      // on the empty string.
      const ticket = await createTicket(fx.prisma, tenant);
      await createMessage(fx.prisma, ticket.id);
      await createMessage(fx.prisma, ticket.id);

      const { items } = await messages.listMessages(
        { ticketId: ticket.id, page: pageRequest({ searchTerm: '   ' }) },
        agent(),
      );

      expect(items).toHaveLength(2);
    });
  });

  describe('createMessage', () => {
    it('1. posts and publishes ticket.message_created', async () => {
      const ticket = await createTicket(fx.prisma, tenant);

      const message = await createTestMessage(
        messages,
        {
          ticketId: ticket.id,
          content: '  My printer is still on fire  ',
          isInternalNote: false,
          invokeAi: false,
        },
        author(),
      );

      expect(message.content).toBe('My printer is still on fire');
      expect(message.senderId).toBe(tenant.userId);
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: TICKET_PATTERNS.messageCreated,
          ticketId: ticket.id,
          messageId: message.id,
          isAiGenerated: false,
        }),
      );
    });

    it('2. carries the EXACT group key Domain E will group on', async () => {
      // Byte-exact, not "similar enough". Domain E groups on string equality,
      // and `ticket:{id}:messages` would silently open a second notification
      // group nobody notices until a user reports duplicates.
      const ticket = await createTicket(fx.prisma, tenant);

      await createTestMessage(
        messages,
        {
          ticketId: ticket.id,
          content: 'hello',
          isInternalNote: false,
          invokeAi: false,
        },
        author(),
      );

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          groupKey: ticketMessageGroupKey(ticket.id),
        }),
      );
    });

    it('3. REFUSES empty and whitespace-only content', async () => {
      const ticket = await createTicket(fx.prisma, tenant);

      await expectRpc(
        createTestMessage(
          messages,
          {
            ticketId: ticket.id,
            content: '   ',
            isInternalNote: false,
            invokeAi: false,
          },
          author(),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('4. answers NOT_FOUND for another tenant’s ticket', async () => {
      const ticket = await createTicket(fx.prisma, tenant);

      await expectRpc(
        createTestMessage(
          messages,
          {
            ticketId: ticket.id,
            content: 'hi',
            isInternalNote: false,
            invokeAi: false,
          },
          author(buildTenant()),
        ),
        status.NOT_FOUND,
      );
    });

    it('5. answers NOT_FOUND to a BYSTANDER in the same tenant', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const bystander = memberContext({
        id: faker.string.uuid(),
        organizationId: tenant.organizationId,
      });

      await expectRpc(
        createTestMessage(
          messages,
          {
            ticketId: ticket.id,
            content: 'hi',
            isInternalNote: false,
            invokeAi: false,
          },
          bystander,
        ),
        status.NOT_FOUND,
      );
    });
  });

  // ---------------------------------------------------------------- invokeAi

  /**
   * Idempotency for the WebSocket transport.
   *
   * **The shape of the transport creates the requirement.** A user clicks Send
   * once; a socket reconnects, and a client holding an unacked message re-emits
   * it. That is correct client behaviour and it double-posts. HTTP clients do
   * not do this, which is exactly why it is easy to miss.
   */
  describe('ClientMessageId idempotency', () => {
    it('20. **a repeated clientMessageId yields ONE row and the ORIGINAL id**', async () => {
      // Returning the original rather than an error is deliberate: the client's
      // intent was satisfied, and an error would make it retry again.
      const ticket = await createTicket(fx.prisma, tenant);
      const clientMessageId = faker.string.uuid();

      const first = await createTestMessage(
        messages,
        {
          ticketId: ticket.id,
          content: 'Sent once, emitted twice',
          isInternalNote: false,
          invokeAi: false,
          clientMessageId,
        },
        author(),
      );
      const second = await createTestMessage(
        messages,
        {
          ticketId: ticket.id,
          content: 'Sent once, emitted twice',
          isInternalNote: false,
          invokeAi: false,
          clientMessageId,
        },
        author(),
      );

      expect(second.id).toBe(first.id);
      await expect(
        fx.prisma.ticketMessage.count({ where: { ticketId: ticket.id } }),
      ).resolves.toBe(1);
    });

    it('21. the duplicate publishes NO second message_created event', async () => {
      // Otherwise Domain E notifies twice and every socket in the room sees the
      // message appear again — the dedup would be invisible where it matters.
      const ticket = await createTicket(fx.prisma, tenant);
      const clientMessageId = faker.string.uuid();
      const send = () =>
        createTestMessage(
          messages,
          {
            ticketId: ticket.id,
            content: 'Once',
            isInternalNote: false,
            invokeAi: false,
            clientMessageId,
          },
          author(),
        );

      await send();
      publish.mockClear();
      await send();

      expect(publish).not.toHaveBeenCalled();
    });

    it('22. CONCURRENT re-emits still produce one row — the index, not the read', async () => {
      // The check and the insert are two statements, so two concurrent
      // re-emits both read "not seen" and both write. Only
      // `ticket_messages_client_key` makes one of them lose, and the catch
      // turns that loss into the same answer.
      const ticket = await createTicket(fx.prisma, tenant);
      const clientMessageId = faker.string.uuid();
      const send = () =>
        createTestMessage(
          messages,
          {
            ticketId: ticket.id,
            content: 'Racing',
            isInternalNote: false,
            invokeAi: false,
            clientMessageId,
          },
          author(),
        );

      const [a, b] = await Promise.all([send(), send()]);

      expect(a.id).toBe(b.id);
      await expect(
        fx.prisma.ticketMessage.count({ where: { ticketId: ticket.id } }),
      ).resolves.toBe(1);
    });

    it('23. the SAME id in a DIFFERENT ticket is two messages, not a collision', async () => {
      // Uniqueness is per ticket, matching the index. Two threads are two
      // intents, and collapsing them would silently drop a real message.
      const first = await createTicket(fx.prisma, tenant);
      const second = await createTicket(fx.prisma, tenant);
      const clientMessageId = faker.string.uuid();

      const body = {
        content: 'Same id',
        isInternalNote: false,
        invokeAi: false,
      };
      const a = await createTestMessage(
        messages,
        { ...body, ticketId: first.id, clientMessageId },
        author(),
      );
      const b = await createTestMessage(
        messages,
        { ...body, ticketId: second.id, clientMessageId },
        author(),
      );

      expect(a.id).not.toBe(b.id);
    });

    it('24. an HTTP-style call with NO clientMessageId is never deduped', async () => {
      // The column is NULL for every HTTP message, and the partial index
      // excludes NULLs — otherwise two ordinary replies would collide.
      const ticket = await createTicket(fx.prisma, tenant);
      const body = {
        ticketId: ticket.id,
        content: 'Ordinary reply',
        isInternalNote: false,
        invokeAi: false,
      };

      await createTestMessage(messages, body, author());
      await createTestMessage(messages, body, author());

      await expect(
        fx.prisma.ticketMessage.count({ where: { ticketId: ticket.id } }),
      ).resolves.toBe(2);
    });
  });

  describe('invokeAi', () => {
    it('1. KEEPS the user message when the AI call fails', async () => {
      // The second test, and the reason the two writes are separate. A
      // rollback here would throw away what a human typed because a machine
      // could not answer them.
      isAvailable.mockReturnValue(true);
      generateReplyDraft.mockRejectedValue(new Error('rag-service is down'));

      const ticket = await createTicket(fx.prisma, tenant);

      const message = await createTestMessage(
        messages,
        {
          ticketId: ticket.id,
          content: 'Please help',
          isInternalNote: false,
          invokeAi: true,
        },
        author(),
      );

      const rows = await fx.prisma.ticketMessage.findMany({
        where: { ticketId: ticket.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(message.id);
      expect(rows[0].content).toBe('Please help');
    });

    it('2. does not FAIL the request when the AI call fails', async () => {
      isAvailable.mockReturnValue(true);
      generateReplyDraft.mockRejectedValue(new Error('rag-service is down'));

      const ticket = await createTicket(fx.prisma, tenant);

      await expect(
        createTestMessage(
          messages,
          {
            ticketId: ticket.id,
            content: 'Please help',
            isInternalNote: false,
            invokeAi: true,
          },
          author(),
        ),
      ).resolves.toBeDefined();
    });

    it('3. appends a SECOND message with no sender when the AI answers', async () => {
      isAvailable.mockReturnValue(true);
      generateReplyDraft.mockResolvedValue({
        content: 'Have you tried turning it off and on again?',
        modelName: 'test-model-v1',
        promptTokens: 120,
        completionTokens: 80,
        // The whole `AiReplyDraft`: the reply now persists its citations,
        // so a mock without them fails the append rather than the assertion.
        generationId: 'gen-auto-reply',
        citations: [],
      });

      const ticket = await createTicket(fx.prisma, tenant);
      await createTestMessage(
        messages,
        {
          ticketId: ticket.id,
          content: 'Please help',
          isInternalNote: false,
          invokeAi: true,
        },
        author(),
      );

      const rows = await fx.prisma.ticketMessage.findMany({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(rows).toHaveLength(2);
      // Absent on purpose: attributing generated words to a real person would
      // put them in that person's mouth in a permanent record.
      expect(rows[1].senderId).toBeNull();
      expect(rows[1].isAiGenerated).toBe(true);
      expect(rows[1].modelName).toBe('test-model-v1');
      expect(rows[1].promptTokens).toBe(120);
    });

    it('4. publishes TWO message_created events when the AI answers', async () => {
      isAvailable.mockReturnValue(true);
      generateReplyDraft.mockResolvedValue({
        content: 'A generated reply',
        modelName: 'test-model-v1',
        promptTokens: 10,
        completionTokens: 20,
        // The whole `AiReplyDraft`: the reply now persists its citations,
        // so a mock without them fails the append rather than the assertion.
        generationId: 'gen-auto-reply',
        citations: [],
      });

      const ticket = await createTicket(fx.prisma, tenant);
      await createTestMessage(
        messages,
        {
          ticketId: ticket.id,
          content: 'Please help',
          isInternalNote: false,
          invokeAi: true,
        },
        author(),
      );

      expect(publish).toHaveBeenCalledTimes(2);
      expect(publish).toHaveBeenLastCalledWith(
        expect.objectContaining({ isAiGenerated: true, senderId: null }),
      );
    });

    it('5. SKIPS the AI call entirely when rag-service is unconfigured', async () => {
      // The default in this repo today. Skipping rather than calling-and-
      // catching keeps a guaranteed failure out of the error log, where it
      // would be noise that trains people to ignore it.
      const ticket = await createTicket(fx.prisma, tenant);

      await createTestMessage(
        messages,
        {
          ticketId: ticket.id,
          content: 'Please help',
          isInternalNote: false,
          invokeAi: true,
        },
        author(),
      );

      expect(generateReplyDraft).not.toHaveBeenCalled();
      expect(
        await fx.prisma.ticketMessage.count({ where: { ticketId: ticket.id } }),
      ).toBe(1);
    });
  });

  // ----------------------------------------------------------------- edit

  describe('updateMessage', () => {
    it('1. lets the SENDER edit inside the window, stamping editedAt', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id, {
        senderId: tenant.userId,
      });

      const updated = await messages.updateMessage(
        { ticketId: ticket.id, messageId: message.id, content: 'Corrected' },
        author(),
      );

      expect(updated.content).toBe('Corrected');
      expect(updated.editedAt).toBeDefined();
    });

    it('2. REFUSES the sender outside the window', async () => {
      // Backdated well past the 15-minute window in .env.test.
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await fx.prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: tenant.userId,
          content: 'Said something regrettable',
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      });

      await expectRpc(
        messages.updateMessage(
          { ticketId: ticket.id, messageId: message.id, content: 'Nicer' },
          author(),
        ),
        status.FAILED_PRECONDITION,
      );
    });

    it('3. lets a MODERATOR edit an internal note past the window', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const note = await fx.prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: faker.string.uuid(),
          content: 'Stale triage note',
          isInternalNote: true,
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      });

      const updated = await messages.updateMessage(
        { ticketId: ticket.id, messageId: note.id, content: 'Re-triaged' },
        moderator(),
      );

      expect(updated.content).toBe('Re-triaged');
    });

    it('4. REFUSES a moderator editing somebody else’s PUBLIC message', async () => {
      // The important half of the rule. An agent rewriting a customer's words
      // in the permanent thread is exactly what an audit timeline exists to
      // make impossible — moderation covers internal notes, not other people's
      // speech.
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id, {
        senderId: tenant.userId,
        isInternalNote: false,
      });

      await expectRpc(
        messages.updateMessage(
          {
            ticketId: ticket.id,
            messageId: message.id,
            content: 'Words they never said',
          },
          moderator(),
        ),
        status.PERMISSION_DENIED,
      );
    });

    it('5. REFUSES editing a redacted message', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await fx.prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: tenant.userId,
          content: REDACTED_MESSAGE_PLACEHOLDER,
          redactedAt: new Date(),
          redactedById: tenant.agentId,
        },
      });

      await expectRpc(
        messages.updateMessage(
          { ticketId: ticket.id, messageId: message.id, content: 'Back again' },
          author(),
        ),
        status.FAILED_PRECONDITION,
      );
    });

    it('6. REFUSES editing an AI-generated message', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const reply = await createAiMessage(fx.prisma, ticket.id);

      await expectRpc(
        messages.updateMessage(
          { ticketId: ticket.id, messageId: reply.id, content: 'Rewritten' },
          moderator(),
        ),
        status.FAILED_PRECONDITION,
      );
    });
  });

  // --------------------------------------------------------------- redact

  describe('redactMessage', () => {
    it('1. replaces content and KEEPS the row in place', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      await createMessage(fx.prisma, ticket.id, { content: 'First' });
      const offending = await createMessage(fx.prisma, ticket.id, {
        content: 'My card number is 4111 1111 1111 1111',
      });
      await createMessage(fx.prisma, ticket.id, { content: 'Third' });

      await messages.redactMessage(
        { ticketId: ticket.id, messageId: offending.id },
        moderator(),
      );

      const rows = await fx.prisma.ticketMessage.findMany({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: 'asc' },
      });

      // Three rows still, and the redacted one still SECOND — the position is
      // the thing worth preserving, because the reply after it stops making
      // sense in a thread that silently lost a turn.
      expect(rows).toHaveLength(3);
      expect(rows[1].id).toBe(offending.id);
      expect(rows[1].content).toBe(REDACTED_MESSAGE_PLACEHOLDER);
      expect(rows[1].redactedAt).not.toBeNull();
      expect(rows[1].redactedById).toBe(tenant.agentId);
    });

    it('2. REFUSES a caller without ticket.message.moderate', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id, {
        senderId: tenant.userId,
      });

      await expectRpc(
        messages.redactMessage(
          { ticketId: ticket.id, messageId: message.id },
          author(),
        ),
        status.PERMISSION_DENIED,
      );
    });

    it('3. REFUSES redacting the same message twice', async () => {
      // A second redaction would move `redacted_at` forward and record a new
      // redactor for something already gone — rewriting the audit trail of the
      // very action the trail exists for.
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);
      await messages.redactMessage(
        { ticketId: ticket.id, messageId: message.id },
        moderator(),
      );

      await expectRpc(
        messages.redactMessage(
          { ticketId: ticket.id, messageId: message.id },
          moderator(),
        ),
        status.FAILED_PRECONDITION,
      );
    });

    it('4. returns the message, not nothing', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);

      const response = await messages.redactMessage(
        { ticketId: ticket.id, messageId: message.id },
        moderator(),
      );

      expect(response.message?.content).toBe(REDACTED_MESSAGE_PLACEHOLDER);
      expect(response.message?.id).toBe(message.id);
    });
  });

  // ---------------------------------------------------------- attachments

  describe('attachments', () => {
    /** storage-service is a separate peer; its own suite covers its internals. */
    let presignAttachment: jest.SpyInstance;
    let confirmUpload: jest.SpyInstance;
    let resolveReadUrls: jest.SpyInstance;
    let emitSuperseded: jest.SpyInstance;

    beforeEach(() => {
      const storage = fx.moduleRef.get(StorageReferenceService);
      presignAttachment = jest
        .spyOn(storage, 'presignAttachment')
        .mockResolvedValue({
          uploadUrl: 'https://storage.example/put',
          // Presign hands back a `pending/` path.
          objectPath: 'organizations/o/tickets/t/attachments/pending/m/abc.png',
          expiresAt: new Date(Date.now() + 600_000),
        });
      confirmUpload = jest.spyOn(storage, 'confirmUpload').mockResolvedValue({
        // And confirm hands back the COMMITTED one, which is what the row
        // records. Stubbed with the move already applied, because that is what
        // storage-service actually returns.
        objectPath: 'organizations/o/tickets/t/attachments/m/abc.png',
        sizeBytes: 2048,
        contentType: 'image/png',
      });
      resolveReadUrls = jest
        .spyOn(storage, 'resolveReadUrls')
        .mockImplementation((paths) =>
          Promise.resolve(
            Object.fromEntries(
              paths.map((path) => [path, `https://signed/${path}`]),
            ),
          ),
        );
      emitSuperseded = jest
        .spyOn(storage, 'emitSuperseded')
        .mockImplementation(() => {});
    });

    const uploadRequest = (ticketId: string, messageId: string) => ({
      ticketId,
      messageId,
      fileName: 'screenshot.png',
      fileSizeBytes: 2048,
      mimeType: 'image/png',
    });

    it('1. presigns an upload for a message the caller can see', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id, {
        senderId: tenant.userId,
      });

      const presigned = await messages.uploadAttachment(
        uploadRequest(ticket.id, message.id),
        author(),
      );

      expect(presigned.uploadUrl).toBeTruthy();
      expect(presigned.objectPath).toBeTruthy();
      expect(presignAttachment).toHaveBeenCalledWith(
        expect.objectContaining({ ticketId: ticket.id, messageId: message.id }),
        expect.anything(),
      );
    });

    it('2. checks the ACL BEFORE calling storage', async () => {
      // Otherwise the presign becomes an oracle: a signed URL for a real ticket
      // and a 404 for a fake one tells a stranger which ticket ids exist.
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);

      await expectRpc(
        messages.uploadAttachment(
          uploadRequest(ticket.id, message.id),
          author(buildTenant()),
        ),
        status.NOT_FOUND,
      );

      expect(presignAttachment).not.toHaveBeenCalled();
    });

    it('3. REFUSES a sixth attachment before signing anything', async () => {
      // The cap must SHORT-CIRCUIT, not merely also-reject downstream: a caller
      // already at the cap must never receive a usable URL, or they discover
      // the refusal only after uploading the bytes.
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);
      for (let i = 0; i < MAX_ATTACHMENTS_PER_MESSAGE; i++) {
        await createAttachment(fx.prisma, message.id);
      }

      await expectRpc(
        messages.uploadAttachment(
          uploadRequest(ticket.id, message.id),
          author(),
        ),
        status.FAILED_PRECONDITION,
      );

      expect(presignAttachment).not.toHaveBeenCalled();
    });

    it('4. ALLOWS the last attachment under the cap', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);
      for (let i = 0; i < MAX_ATTACHMENTS_PER_MESSAGE - 1; i++) {
        await createAttachment(fx.prisma, message.id);
      }

      await expect(
        messages.uploadAttachment(
          uploadRequest(ticket.id, message.id),
          author(),
        ),
      ).resolves.toBeDefined();
    });

    it('5. confirming writes the row with the REAL size and type', async () => {
      // Not the values the client declared at presign — those were a hint for
      // the policy check, and a row built from them would record whatever the
      // client felt like claiming.
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);
      confirmUpload.mockResolvedValue({
        // The committed path, which is what the row records.
        objectPath: 'organizations/o/t/a/real.pdf',
        sizeBytes: 9999,
        contentType: 'application/pdf',
      });

      const attachment = await messages.confirmAttachment(
        {
          ticketId: ticket.id,
          messageId: message.id,
          objectPath: 'organizations/o/t/a/real.pdf',
          fileName: 'invoice.pdf',
        },
        author(),
      );

      expect(attachment.fileSizeBytes).toBe(9999);
      expect(attachment.mimeType).toBe('application/pdf');
      expect(attachment.fileUrl).toBe('organizations/o/t/a/real.pdf');
    });

    it('6. stores an object PATH, never a URL', async () => {
      // Reads resolve it to a fresh signed URL per request, so revoking access
      // takes effect on the NEXT read rather than whenever a stored URL happens
      // to expire.
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);

      await messages.confirmAttachment(
        {
          ticketId: ticket.id,
          messageId: message.id,
          objectPath: 'organizations/o/t/a/x.png',
          fileName: 'x.png',
        },
        author(),
      );

      const row = await fx.prisma.messageAttachment.findFirstOrThrow({
        where: { messageId: message.id },
      });
      expect(row.fileUrl).not.toMatch(/^https?:/);
    });

    it('7. the thread listing includes the attachment', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);
      await createAttachment(fx.prisma, message.id, {
        fileName: 'invoice.pdf',
      });

      const { items } = await messages.listMessages(
        listRequest(ticket.id),
        author(),
      );

      expect(items[0].attachments).toHaveLength(1);
      expect(items[0].attachments[0].fileName).toBe('invoice.pdf');
    });

    it('8. download re-checks tenant + ticket ACL BEFORE signing', async () => {
      // `message_attachments` has no tenant column; it reaches one only through
      // message -> ticket. A lookup by attachment id alone would hand another
      // tenant's file to whoever guessed the id — and storage-service does not
      // know this ticket's ACL and never will.
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);
      const attachment = await createAttachment(fx.prisma, message.id);

      await expectRpc(
        messages.downloadAttachment(
          { attachmentId: attachment.id },
          author(buildTenant()),
        ),
        status.NOT_FOUND,
      );

      expect(resolveReadUrls).not.toHaveBeenCalled();
    });

    it('9. download refuses a BYSTANDER in the same tenant', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);
      const attachment = await createAttachment(fx.prisma, message.id);

      await expectRpc(
        messages.downloadAttachment(
          { attachmentId: attachment.id },
          memberContext({
            id: faker.string.uuid(),
            organizationId: tenant.organizationId,
          }),
        ),
        status.NOT_FOUND,
      );
    });

    it('10. download returns a signed URL for a caller who MAY see it', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);
      const attachment = await createAttachment(fx.prisma, message.id);

      const result = await messages.downloadAttachment(
        { attachmentId: attachment.id },
        author(),
      );

      expect(result.downloadUrl).toContain('https://signed/');
      expect(result.expiresAt).toBeDefined();
    });

    it('11. download 404s when the OBJECT is gone but the row is not', async () => {
      // A delete that outran its row, or a bucket restored from a backup the
      // database has moved past. Answering with an unusable URL would be worse.
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);
      const attachment = await createAttachment(fx.prisma, message.id);
      resolveReadUrls.mockResolvedValue({});

      await expectRpc(
        messages.downloadAttachment({ attachmentId: attachment.id }, author()),
        status.NOT_FOUND,
      );
    });

    it('12. download 404s for an attachment id that does not exist', async () => {
      await expectRpc(
        messages.downloadAttachment(
          { attachmentId: faker.string.uuid() },
          author(),
        ),
        status.NOT_FOUND,
      );
    });

    it('13. deleting removes the row AND emits the supersede', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);
      const attachment = await createAttachment(fx.prisma, message.id, {
        fileUrl: 'organizations/o/t/a/doomed.png',
      });

      await messages.deleteAttachment(
        { attachmentId: attachment.id },
        moderator(),
      );

      expect(
        await fx.prisma.messageAttachment.count({
          where: { id: attachment.id },
        }),
      ).toBe(0);
      expect(emitSuperseded).toHaveBeenCalledWith(
        'organizations/o/t/a/doomed.png',
        SupersededReason.RECORD_DELETED,
      );
    });

    it('14. deleting REQUIRES ticket.message.moderate', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);
      const attachment = await createAttachment(fx.prisma, message.id);

      await expectRpc(
        messages.deleteAttachment({ attachmentId: attachment.id }, author()),
        status.PERMISSION_DENIED,
      );

      expect(
        await fx.prisma.messageAttachment.count({
          where: { id: attachment.id },
        }),
      ).toBe(1);
    });

    it('15. listing attachments is scoped through the MESSAGE', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const message = await createMessage(fx.prisma, ticket.id);
      await createAttachment(fx.prisma, message.id);

      const { items } = await messages.listAttachments(
        { ticketId: ticket.id, messageId: message.id },
        author(),
      );
      expect(items).toHaveLength(1);

      await expectRpc(
        messages.listAttachments(
          { ticketId: ticket.id, messageId: message.id },
          author(buildTenant()),
        ),
        status.NOT_FOUND,
      );
    });
  });

  // ---------------------------------------- the review loop's join

  describe('generatedFromId', () => {
    let recordOutcome: jest.SpyInstance;

    beforeEach(() => {
      recordOutcome = jest
        .spyOn(fx.moduleRef.get(LedgerClientService), 'recordOutcome')
        .mockResolvedValue('ACCEPTED');
    });

    it('1. records the outcome against the GENERATION the agent sent', async () => {
      // The whole point of the field. Without this join, `ai_generations` knows
      // a draft was produced and nothing about whether a human used it — and
      // "was the co-pilot worth paying for" is the one question the ledger
      // exists to answer.
      const ticket = await createTicket(fx.prisma, tenant);
      const generationId = faker.string.uuid();

      const message = await createTestMessage(
        messages,
        {
          ticketId: ticket.id,
          content: 'Have you tried restarting it?',
          isInternalNote: false,
          invokeAi: false,
          generatedFromId: generationId,
        },
        agent(),
      );

      expect(recordOutcome).toHaveBeenCalledWith(
        generationId,
        message.id,
        // The SENT text, so rag-service can compare it against what it drafted
        // and decide ACCEPTED vs EDITED. Sending the draft back instead would
        // make every message look accepted.
        'Have you tried restarting it?',
        expect.anything(),
      );
    });

    it('2. posts normally WITHOUT it — the field is optional', async () => {
      // Most messages are typed by a human with no draft involved, and a
      // required field here would break the ordinary path.
      const ticket = await createTicket(fx.prisma, tenant);

      const message = await createTestMessage(
        messages,
        {
          ticketId: ticket.id,
          content: 'Typed from scratch',
          isInternalNote: false,
          invokeAi: false,
        },
        agent(),
      );

      expect(message.id).toBeTruthy();
      expect(recordOutcome).not.toHaveBeenCalled();
    });

    it('3. still SENDS the message when the outcome write fails', async () => {
      // The deliberate order: the message is committed first and the outcome
      // recorded after, non-blocking. Losing a customer's reply to protect a
      // metric is exactly the wrong trade — the sweep marking it DISCARDED is
      // the honest cost, and it is logged.
      recordOutcome.mockResolvedValue(null);
      const ticket = await createTicket(fx.prisma, tenant);

      const message = await createTestMessage(
        messages,
        {
          ticketId: ticket.id,
          content: 'Sent anyway',
          isInternalNote: false,
          invokeAi: false,
          generatedFromId: faker.string.uuid(),
        },
        agent(),
      );

      await expect(
        fx.prisma.ticketMessage.findUnique({ where: { id: message.id } }),
      ).resolves.not.toBeNull();
    });
  });
});
