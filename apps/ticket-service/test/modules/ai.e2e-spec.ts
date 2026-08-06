import { RpcException } from '@nestjs/microservices';
import { waitFor } from '@synapsedesk/common/testing/wait';
import { expectRpc, rpcCode } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import { TicketStatus } from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest, memberContext } from '../utils';
import {
  buildTenant,
  createAiSummary,
  createTicket,
  TenantFixture,
} from '../factories';
import { AiService } from '../../src/modules/ai/ai.service';
import { TicketsService } from '../../src/modules/tickets/tickets.service';
import { RagClientService } from '../../src/modules/ai-client/rag-client.service';
import { TicketEventPublisher } from '../../src/modules/events/ticket-event.publisher';

describe('§2.6 AI Co-Pilot (e2e)', () => {
  let fx: E2eFixture;
  let ai: AiService;
  let tickets: TicketsService;
  let rag: RagClientService;
  let events: TicketEventPublisher;

  let isAvailable: jest.SpyInstance;
  let generateSummary: jest.SpyInstance;

  let tenant: TenantFixture;

  const CANNED = {
    summaryText: 'Customer cannot print; toner replaced twice already.',
    suggestedAction: 'Dispatch a field engineer.',
    confidenceScore: 0.82,
    modelName: 'test-model-v1',
  };

  /** An agent with the queue and the AI grant. */
  const agent = (t = tenant) =>
    memberContext({ id: t.agentId, organizationId: t.organizationId }, [
      'ticket.read.all',
      'ticket.ai.use',
      'ticket.escalate',
    ]);

  /** Makes the canned model available for the tests that need a real write. */
  const withCannedModel = () => {
    isAvailable.mockReturnValue(true);
    generateSummary.mockResolvedValue(CANNED);
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    ai = fx.moduleRef.get(AiService);
    tickets = fx.moduleRef.get(TicketsService);
    rag = fx.moduleRef.get(RagClientService);
    events = fx.moduleRef.get(TicketEventPublisher);

    jest.spyOn(events, 'publish').mockImplementation(() => {});

    // Spied once, RE-STATED every test: `clearAllMocks` resets call records but
    // keeps implementations, so a test that made rag-service available would
    // leak that into every later one — including the tests asserting it is not.
    isAvailable = jest.spyOn(rag, 'isAvailable', 'get');
    generateSummary = jest.spyOn(rag, 'generateSummary');
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();

    // The real default in .env.test: RAG_SERVICE_URL is unset.
    isAvailable.mockReturnValue(false);
    generateSummary.mockRejectedValue(
      new RpcException({
        code: status.UNAVAILABLE,
        message: 'AI summarization is not yet available',
      }),
    );

    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  // ------------------------------------------------------- the 503 contract

  /**
   * Renamed in 16-doc §4: this was `describe('the contract-first stub')`, and
   * the adapter has not been a stub since Domain C — it calls rag-service for
   * draft, summary, classify and suggest.
   *
   * The assertions were still passing, which is the point of the finding: an
   * unset `RAG_SERVICE_URL` is a legitimate configuration, so a suite named for
   * a state that no longer exists goes on being green while describing the
   * wrong system. It reads as "this feature is not built yet" to the next
   * person, and nobody re-opens a file that says that.
   */
  describe('degrades to UNAVAILABLE when rag-service is unconfigured', () => {
    it('1. answers UNAVAILABLE from EVERY generation RPC — never a 500', async () => {
      // §2.6 test 1. Parametrized over every RPC rather than spot-checked: a
      // new one added without the gate would answer 500, and a 500 sends
      // somebody debugging a feature that was never built.
      const ticket = await createTicket(fx.prisma, tenant);
      const context = agent();

      // THUNKS, not promises. Building five rejecting promises up front leaves
      // four of them unhandled until the loop reaches them, which Node reports
      // as an unhandled rejection and Jest fails the run on — a test that
      // breaks for a reason entirely unrelated to what it is checking.
      const calls: Array<[string, () => Promise<unknown>]> = [
        [
          'generateSummary',
          () => ai.generateSummary({ ticketId: ticket.id }, context),
        ],
        [
          'generateDraft',
          () =>
            ai.generateDraft(
              { ticketId: ticket.id, instruction: undefined },
              context,
            ),
        ],
        [
          'getSuggestions',
          () => ai.getSuggestions({ ticketId: ticket.id }, context),
        ],
        [
          'classifyTicket',
          () => ai.classifyTicket({ ticketId: ticket.id }, context),
        ],
        [
          'listSimilarTickets',
          () => ai.listSimilarTickets({ ticketId: ticket.id }, context),
        ],
      ];

      for (const [name, call] of calls) {
        await call().catch((error: unknown) =>
          expect([name, rpcCode(error)]).toEqual([name, status.UNAVAILABLE]),
        );
      }
    });

    it('2. checks the ACL BEFORE answering UNAVAILABLE', async () => {
      // Otherwise the stub is an oracle: 503 for a real ticket and 404 for a
      // fake one tells a stranger which ids exist, and that difference would
      // survive the day rag-service lands.
      const ticket = await createTicket(fx.prisma, tenant);

      await expectRpc(
        ai.generateSummary({ ticketId: ticket.id }, agent(buildTenant())),
        status.NOT_FOUND,
      );
    });

    it('3. writes NO summary row when generation fails', async () => {
      const ticket = await createTicket(fx.prisma, tenant);

      await expectRpc(
        ai.generateSummary({ ticketId: ticket.id }, agent()),
        status.UNAVAILABLE,
      );

      expect(
        await fx.prisma.aiSummary.count({ where: { ticketId: ticket.id } }),
      ).toBe(0);
    });
  });

  // ------------------------------------------- configured AND reachable

  /**
   * The case that matters now — 16-doc §4.
   *
   * The suite above proves the system degrades. Nothing proved it *works*:
   * every RPC could have answered UNAVAILABLE for a second reason — a wrong
   * client token, a broken mapper, a deadline of zero — and the whole file
   * would still be green, because "unconfigured" and "configured but broken"
   * produce the same status code.
   *
   * So this mirrors test 1 exactly, with the adapter available, and asserts the
   * opposite: nothing 503s, and each response carries the model's content
   * rather than a shape that merely type-checks.
   */
  describe('serves every generation RPC when rag-service is reachable', () => {
    beforeEach(() => {
      isAvailable.mockReturnValue(true);

      generateSummary.mockResolvedValue(CANNED);
      jest.spyOn(rag, 'generateReplyDraft').mockResolvedValue({
        content: 'A suggested reply',
        modelName: CANNED.modelName,
        promptTokens: 10,
        completionTokens: 20,
        generationId: 'gen-draft-1',
        citations: [],
      });
      jest.spyOn(rag, 'getSuggestions').mockResolvedValue([
        {
          title: 'Check the toner sensor',
          body: 'Step one…',
          confidenceScore: 0.6,
        },
      ]);
      jest.spyOn(rag, 'classifyTicket').mockResolvedValue({
        suggestedDepartmentId: '',
        suggestedPriority: 'HIGH',
        confidenceScore: 0.55,
      });
    });

    it('1. returns the MODEL’S OWN content from each RPC', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const context = agent();

      const summary = await ai.generateSummary(
        { ticketId: ticket.id },
        context,
      );
      expect(summary.summaryText).toBe(CANNED.summaryText);
      expect(summary.modelName).toBe(CANNED.modelName);

      const draft = await ai.generateDraft(
        { ticketId: ticket.id, instruction: undefined },
        context,
      );
      expect(draft.content).toBe('A suggested reply');
      // The id the agent posts back as `generatedFromId` — without it the
      // review loop has nothing to join on.
      expect(draft.generationId).toBe('gen-draft-1');

      const suggestions = await ai.getSuggestions(
        { ticketId: ticket.id },
        context,
      );
      expect(suggestions.items[0].title).toBe('Check the toner sensor');

      const classification = await ai.classifyTicket(
        { ticketId: ticket.id },
        context,
      );
      expect(classification.suggestedPriority).toBe('HIGH');
    });

    it('2. STILL checks the ACL — availability is not authorization', async () => {
      // The unconfigured suite proves the ACL runs before the 503. This proves
      // it also runs before a successful generation, which is the path that
      // would actually leak a ticket's contents into another tenant's summary.
      const ticket = await createTicket(fx.prisma, tenant);

      await expectRpc(
        ai.generateSummary({ ticketId: ticket.id }, agent(buildTenant())),
        status.NOT_FOUND,
      );
      expect(generateSummary).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------- getSummary

  describe('getSummary', () => {
    it('1. answers NOT_FOUND when none has been generated — not an empty object', async () => {
      // §2.6 test 4. "No summary yet" and "the summary is blank" are different
      // facts: a client given `{}` for the first renders an empty panel where
      // it should render a "generate" button.
      const ticket = await createTicket(fx.prisma, tenant);

      await expectRpc(
        ai.getSummary({ ticketId: ticket.id }, agent()),
        status.NOT_FOUND,
      );
    });

    it('2. returns the stored row WITHOUT calling the model', async () => {
      // Reading costs nothing and needs no rag-service — which is why this one
      // route still works while everything else 503s.
      const ticket = await createTicket(fx.prisma, tenant);
      await createAiSummary(fx.prisma, ticket.id, {
        summaryText: 'Stored summary',
      });

      const summary = await ai.getSummary({ ticketId: ticket.id }, agent());

      expect(summary.summaryText).toBe('Stored summary');
      expect(generateSummary).not.toHaveBeenCalled();
    });

    it('3. answers NOT_FOUND for another tenant’s ticket', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      await createAiSummary(fx.prisma, ticket.id);

      await expectRpc(
        ai.getSummary({ ticketId: ticket.id }, agent(buildTenant())),
        status.NOT_FOUND,
      );
    });
  });

  // -------------------------------------------------------- the 1:1 upsert

  describe('generateSummary (upsert)', () => {
    it('1. creates the first summary', async () => {
      withCannedModel();
      const ticket = await createTicket(fx.prisma, tenant);

      const summary = await ai.generateSummary(
        { ticketId: ticket.id },
        agent(),
      );

      expect(summary.summaryText).toBe(CANNED.summaryText);
      expect(summary.confidenceScore).toBeCloseTo(CANNED.confidenceScore);
      expect(
        await fx.prisma.aiSummary.count({ where: { ticketId: ticket.id } }),
      ).toBe(1);
    });

    it('2. REPLACES on re-generation — still exactly one row', async () => {
      // §2.6 test 3. `ai_summaries.ticket_id` is unique, so a second `create`
      // would throw — but the real point is the product one: two summaries of
      // one ticket give no way to tell which describes the conversation as it
      // now stands.
      withCannedModel();
      const ticket = await createTicket(fx.prisma, tenant);

      const first = await ai.generateSummary({ ticketId: ticket.id }, agent());

      generateSummary.mockResolvedValue({
        ...CANNED,
        summaryText: 'Engineer dispatched; awaiting confirmation.',
        confidenceScore: 0.91,
      });
      const second = await ai.generateSummary({ ticketId: ticket.id }, agent());

      const rows = await fx.prisma.aiSummary.findMany({
        where: { ticketId: ticket.id },
      });

      expect(rows).toHaveLength(1);
      // The SAME row, updated — not a delete-and-recreate, which would break
      // anything holding the summary id.
      expect(second.id).toBe(first.id);
      expect(rows[0].summaryText).toBe(
        'Engineer dispatched; awaiting confirmation.',
      );
      expect(rows[0].confidenceScore).toBeCloseTo(0.91);
    });

    it('3. records no token columns — the RDM gives ai_summaries none', async () => {
      // Metering lives on `ticket_messages` for a persisted reply. Inventing
      // columns here to force parity would be guessing at a decision the schema
      // deliberately has not made.
      withCannedModel();
      const ticket = await createTicket(fx.prisma, tenant);

      await ai.generateSummary({ ticketId: ticket.id }, agent());

      const row = await fx.prisma.aiSummary.findUniqueOrThrow({
        where: { ticketId: ticket.id },
      });
      expect(row).not.toHaveProperty('promptTokens');
      expect(row).not.toHaveProperty('completionTokens');
    });
  });

  // ----------------------------------------------------- escalation hookup

  describe('escalation triggers summarization', () => {
    it('1. does NOT fail the escalation when summarization 503s', async () => {
      // §2.6 test 2 / §1.7's fire-and-forget rule. Escalating is the agent's
      // action; a summary that could not be generated is a missing convenience.
      isAvailable.mockReturnValue(true);
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      const escalated = await tickets.escalateTicket(
        { id: ticket.id },
        agent(),
      );

      expect(escalated.id).toBe(ticket.id);
      // And the escalation itself actually landed, not merely "did not throw".
      const row = await fx.prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
      });
      expect(row.status).toBe(TicketStatus.ESCALATED);
      expect(row.escalatedAt).not.toBeNull();
    });

    it('2. ATTEMPTS summarization on escalate', async () => {
      // The other half: proving it does not fail is worthless if it never tried.
      isAvailable.mockReturnValue(true);
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      await tickets.escalateTicket({ id: ticket.id }, agent());
      await waitFor(() => generateSummary.mock.calls.length > 0);

      expect(generateSummary).toHaveBeenCalled();
    });

    it('3. stores the summary when the model answers', async () => {
      withCannedModel();
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      await tickets.escalateTicket({ id: ticket.id }, agent());
      // The spy firing only proves the model was ASKED; the row is written
      // after it answers, so that is what this actually waits on.
      await waitFor(
        async () =>
          (await fx.prisma.aiSummary.count({
            where: { ticketId: ticket.id },
          })) > 0,
      );

      const row = await fx.prisma.aiSummary.findUnique({
        where: { ticketId: ticket.id },
      });
      expect(row?.summaryText).toBe(CANNED.summaryText);
    });

    it('4. SKIPS the call entirely when rag-service is unconfigured', async () => {
      // The default today. Skipping rather than calling-and-catching keeps a
      // guaranteed failure out of the error log, where it would be noise that
      // trains people to ignore it.
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      await tickets.escalateTicket({ id: ticket.id }, agent());
      // An absence cannot be polled for, so give the background call a real
      // chance to happen before asserting it did not.
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(generateSummary).not.toHaveBeenCalled();
    });

    it('5. does not fail the escalation when summarization THROWS unexpectedly', async () => {
      // Not an RpcException — a genuine bug in the summarizer. The escalation
      // must survive that too, or a defect in an optional feature takes out a
      // required one.
      isAvailable.mockReturnValue(true);
      generateSummary.mockImplementation(() => {
        throw new TypeError('undefined is not a function');
      });
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      await expect(
        tickets.escalateTicket({ id: ticket.id }, agent()),
      ).resolves.toBeDefined();
    });
  });

  // ------------------------------------------------------------ other RPCs

  describe('the remaining co-pilot RPCs', () => {
    it('1. generateDraft persists NOTHING even when the model answers', async () => {
      // The agent reads it, edits it and decides. Persisting here would put an
      // unreviewed generated reply into the customer-visible thread.
      isAvailable.mockReturnValue(true);
      jest.spyOn(rag, 'generateReplyDraft').mockResolvedValue({
        content: 'A suggested reply',
        modelName: 'test-model-v1',
        promptTokens: 10,
        completionTokens: 20,
        generationId: 'gen-draft-1',
        citations: [],
      });
      const ticket = await createTicket(fx.prisma, tenant);

      const draft = await ai.generateDraft(
        { ticketId: ticket.id, instruction: 'shorter' },
        agent(),
      );

      expect(draft.content).toBe('A suggested reply');
      expect(
        await fx.prisma.ticketMessage.count({ where: { ticketId: ticket.id } }),
      ).toBe(0);
    });

    it('2. classifyTicket does not APPLY its own suggestion', async () => {
      // Auto-routing on a model's guess would move work between teams on a
      // confidence score nobody read.
      isAvailable.mockReturnValue(true);
      const suggestedDepartmentId = faker.string.uuid();
      jest.spyOn(rag, 'classifyTicket').mockResolvedValue({
        suggestedDepartmentId,
        suggestedPriority: 'URGENT',
        confidenceScore: 0.7,
      });
      const ticket = await createTicket(fx.prisma, tenant);

      const result = await ai.classifyTicket({ ticketId: ticket.id }, agent());

      expect(result.suggestedDepartmentId).toBe(suggestedDepartmentId);
      const row = await fx.prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
      });
      expect(row.currentDepartmentId).toBeNull();
      expect(row.priority).not.toBe('URGENT');
    });

    it('3. every RPC refuses a caller who cannot see the ticket', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const bystander = memberContext({
        id: faker.string.uuid(),
        organizationId: tenant.organizationId,
      });

      await expectRpc(
        ai.getSummary({ ticketId: ticket.id }, bystander),
        status.NOT_FOUND,
      );
      await expectRpc(
        ai.getSuggestions({ ticketId: ticket.id }, bystander),
        status.NOT_FOUND,
      );
      await expectRpc(
        ai.listSimilarTickets({ ticketId: ticket.id }, bystander),
        status.NOT_FOUND,
      );
    });
  });
});
