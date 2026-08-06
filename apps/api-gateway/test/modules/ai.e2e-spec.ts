import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  API,
  E2eFixture,
  anonymousAgent,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { grpcError, timestamp } from '../fixtures/wire';

/**
 * §2.6 The AI co-pilot at the HTTP boundary.
 *
 * Every generation route answers 503 today — that is the contract, not a gap.
 * What is fully live and therefore what this suite is really about: the
 * PERMISSION split. Reading a stored summary is queue access; generating
 * anything is `ticket.ai.use`, which costs money on every call. Collapsing the
 * two would hand a metered budget to everyone who could read a ticket.
 */
describe('§2.6 AI Co-Pilot at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const ticketId = faker.string.uuid();

  const unavailable = () =>
    throwError(() =>
      grpcError(
        GrpcStatus.UNAVAILABLE,
        'AI summarization is not yet available',
      ),
    );

  const wireSummary = () => ({
    id: faker.string.uuid(),
    ticketId,
    summaryText: 'Customer cannot print.',
    suggestedAction: 'Dispatch an engineer.',
    confidenceScore: 0.82,
    modelName: 'test-model-v1',
    createdAt: timestamp(),
    updatedAt: timestamp(),
  });

  beforeAll(async () => {
    await flushTestRedis();
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  describe('the 503 contract', () => {
    it('1. answers 503 — not 500 — from every generation route', async () => {
      // A 500 would send somebody debugging a feature that was never built.
      fx.stubs.ai.generateSummary.mockReturnValue(unavailable());
      fx.stubs.ai.generateDraft.mockReturnValue(unavailable());
      fx.stubs.ai.getSuggestions.mockReturnValue(unavailable());
      fx.stubs.ai.classifyTicket.mockReturnValue(unavailable());

      const client = authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.ai.use'],
      });

      const routes = ['summary', 'draft', 'suggestions', 'classify'];
      for (const route of routes) {
        const res = await client
          .post(`${API}/tickets/${ticketId}/ai/${route}`)
          .send({});
        expect([route, res.status]).toEqual([route, 503]);
      }
    });

    it('2. answers 503 from GET /tickets/:id/similar', async () => {
      fx.stubs.ai.listSimilarTickets.mockReturnValue(unavailable());

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      }).get(`${API}/tickets/${ticketId}/similar`);

      expect(res.status).toBe(503);
    });
  });

  describe('GET /tickets/:ticketId/ai/summary', () => {
    it('1. is gated on ticket.read.all, NOT on ticket.ai.use', async () => {
      // Reading a STORED summary costs nothing and needs no model. Gating it on
      // the generation grant would make an agent pay for a row already written.
      fx.stubs.ai.getSummary.mockReturnValue(of(wireSummary()));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      }).get(`${API}/tickets/${ticketId}/ai/summary`);

      expect(res.status).toBe(200);
      expect(res.body.data.summaryText).toBe('Customer cannot print.');
    });

    it('2. is REFUSED to a caller holding only ticket.ai.use', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.ai.use'],
      }).get(`${API}/tickets/${ticketId}/ai/summary`);

      expect(res.status).toBe(403);
      expect(fx.stubs.ai.getSummary).not.toHaveBeenCalled();
    });

    it('3. maps "no summary yet" to 404, not an empty object', async () => {
      fx.stubs.ai.getSummary.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.NOT_FOUND, 'No summary has been generated yet'),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      }).get(`${API}/tickets/${ticketId}/ai/summary`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /tickets/:ticketId/ai/summary', () => {
    it('1. requires ticket.ai.use — queue access is not enough', async () => {
      // Generation is metered. A caller who may READ the queue has not been
      // granted the right to spend on it.
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      }).post(`${API}/tickets/${ticketId}/ai/summary`);

      expect(res.status).toBe(403);
      expect(fx.stubs.ai.generateSummary).not.toHaveBeenCalled();
    });

    it('2. answers 200, NOT 201 — the summary is an upsert', async () => {
      // "Created" would be a lie on every call after the first, and a client
      // keying off 201 would treat a replacement as a new resource.
      fx.stubs.ai.generateSummary.mockReturnValue(of(wireSummary()));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.ai.use'],
      }).post(`${API}/tickets/${ticketId}/ai/summary`);

      expect(res.status).toBe(200);
    });
  });

  describe('POST /tickets/:ticketId/ai/draft', () => {
    it('1. forwards an optional instruction', async () => {
      fx.stubs.ai.generateDraft.mockReturnValue(
        of({
          content: 'A draft',
          modelName: 'm',
          promptTokens: 1,
          completionTokens: 2,
          // The ledger row the client hands back as `generatedFromId` when the
          // agent posts — without it the acceptance loop cannot close.
          generationId: 'gen-1',
          citations: [],
        }),
      );

      await authenticatedAgent(fx.app, { permissionCodes: ['ticket.ai.use'] })
        .post(`${API}/tickets/${ticketId}/ai/draft`)
        .send({ instruction: 'shorter' });

      const [request] = fx.stubs.ai.generateDraft.mock.calls[0];
      expect(request.instruction).toBe('shorter');
    });

    it('2. accepts an ABSENT instruction — drafting from the thread alone', async () => {
      fx.stubs.ai.generateDraft.mockReturnValue(
        of({
          content: 'A draft',
          modelName: 'm',
          promptTokens: 1,
          completionTokens: 2,
          // The ledger row the client hands back as `generatedFromId` when the
          // agent posts — without it the acceptance loop cannot close.
          generationId: 'gen-1',
          citations: [],
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.ai.use'],
      })
        .post(`${API}/tickets/${ticketId}/ai/draft`)
        .send({});

      expect(res.status).toBe(200);
    });

    it('3. REJECTS an over-long instruction', async () => {
      // This is user text that reaches a model prompt. Unbounded here is an
      // unbounded token bill, quite apart from what someone might try to write.
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.ai.use'],
      })
        .post(`${API}/tickets/${ticketId}/ai/draft`)
        .send({ instruction: 'x'.repeat(501) });

      expect(res.status).toBe(400);
      expect(fx.stubs.ai.generateDraft).not.toHaveBeenCalled();
    });

    it('4. returns the draft WITHOUT any message being created', async () => {
      // The endpoint is read-only by design: an agent reads, edits and decides.
      fx.stubs.ai.generateDraft.mockReturnValue(
        of({
          content: 'A suggested reply',
          modelName: 'm',
          promptTokens: 10,
          completionTokens: 20,
          generationId: 'gen-2',
          citations: [],
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.ai.use'],
      })
        .post(`${API}/tickets/${ticketId}/ai/draft`)
        .send({});

      expect(res.body.data.content).toBe('A suggested reply');
      expect(fx.stubs.message.createMessage).not.toHaveBeenCalled();
    });
  });

  describe('GET /tickets/:ticketId/similar', () => {
    it('1. is gated on ticket.read.all, not on ticket.ai.use', async () => {
      // The RESULTS are other people's tickets, so the permission that matters
      // is the one governing who may read the queue — not who may spend on a
      // model.
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.ai.use'],
      }).get(`${API}/tickets/${ticketId}/similar`);

      expect(res.status).toBe(403);
      expect(fx.stubs.ai.listSimilarTickets).not.toHaveBeenCalled();
    });

    it('2. maps the results once the model answers', async () => {
      fx.stubs.ai.listSimilarTickets.mockReturnValue(
        of({
          items: [
            {
              ticketId: faker.string.uuid(),
              ticketNumber: 4211,
              title: 'Printer on fire',
              similarityScore: 0.93,
            },
          ],
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      }).get(`${API}/tickets/${ticketId}/similar`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].ticketNumber).toBe(4211);
      expect(res.body.data[0].similarityScore).toBeCloseTo(0.93);
    });

    it('3. does not collide with GET /tickets/:id', async () => {
      fx.stubs.ai.listSimilarTickets.mockReturnValue(of({ items: [] }));

      await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all'],
      }).get(`${API}/tickets/${ticketId}/similar`);

      expect(fx.stubs.ai.listSimilarTickets).toHaveBeenCalledTimes(1);
      expect(fx.stubs.ticket.getTicket).not.toHaveBeenCalled();
    });
  });

  describe('access', () => {
    it('1. refuses an ANONYMOUS caller on every AI route', async () => {
      const client = anonymousAgent(fx.app);

      for (const route of ['summary', 'draft', 'suggestions', 'classify']) {
        const res = await client
          .post(`${API}/tickets/${ticketId}/ai/${route}`)
          .send({});
        expect([route, res.status]).toEqual([route, 401]);
      }
    });

    it('2. rejects a NON-UUID ticket id', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.ai.use'],
      }).post(`${API}/tickets/not-a-uuid/ai/summary`);

      expect(res.status).toBe(400);
    });
  });
});
