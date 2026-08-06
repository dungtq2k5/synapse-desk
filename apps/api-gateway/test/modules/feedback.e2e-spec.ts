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
import { grpcError, timestamp, wirePage } from '../fixtures/wire';

describe('§2.8 AI feedback at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const messageId = faker.string.uuid();

  beforeAll(async () => {
    await flushTestRedis();
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  const wireFeedback = (overrides: Record<string, unknown> = {}) => ({
    id: faker.string.uuid(),
    ticketMessageId: messageId,
    userId: faker.string.uuid(),
    organizationId: faker.string.uuid(),
    rating: 1,
    feedbackText: undefined,
    citationAccurate: undefined,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    ...overrides,
  });

  describe('POST /messages/:messageId/feedback', () => {
    it('1. is postable by an end user with NO permissions', async () => {
      // Gating this would collect the opinions only of people senior enough to
      // be granted an opinion — precisely the wrong sample for judging whether
      // the model serves ordinary users.
      fx.stubs.feedback.submitFeedback.mockReturnValue(of(wireFeedback()));

      const res = await authenticatedAgent(fx.app, { permissionCodes: [] })
        .post(`${API}/messages/${messageId}/feedback`)
        .send({ rating: 1 });

      expect(res.status).toBe(200);
    });

    it('2. answers 200, NOT 201 — it is an upsert', async () => {
      // A user changing 👍 to 👎 is the normal case, not an error, and
      // "created" would be a lie every time after the first.
      fx.stubs.feedback.submitFeedback.mockReturnValue(of(wireFeedback()));

      const res = await authenticatedAgent(fx.app)
        .post(`${API}/messages/${messageId}/feedback`)
        .send({ rating: -1 });

      expect(res.status).toBe(200);
    });

    it('3. REJECTS a rating of 0 before any call', async () => {
      const res = await authenticatedAgent(fx.app)
        .post(`${API}/messages/${messageId}/feedback`)
        .send({ rating: 0 });

      expect(res.status).toBe(400);
      expect(fx.stubs.feedback.submitFeedback).not.toHaveBeenCalled();
    });

    it('4. REJECTS a scale value', async () => {
      const res = await authenticatedAgent(fx.app)
        .post(`${API}/messages/${messageId}/feedback`)
        .send({ rating: 5 });

      expect(res.status).toBe(400);
    });

    it('5. REJECTS a client-supplied userId', async () => {
      const res = await authenticatedAgent(fx.app)
        .post(`${API}/messages/${messageId}/feedback`)
        .send({ rating: 1, userId: faker.string.uuid() });

      expect(res.status).toBe(400);
    });

    it('6. renders citationAccurate FALSE as false, not null', async () => {
      // `?? null` and not `|| null`. "The citations were wrong" is the single
      // most useful signal in the row, and `||` would erase it into "not
      // assessed".
      fx.stubs.feedback.submitFeedback.mockReturnValue(
        of(wireFeedback({ citationAccurate: false })),
      );

      const res = await authenticatedAgent(fx.app)
        .post(`${API}/messages/${messageId}/feedback`)
        .send({ rating: -1, citationAccurate: false });

      expect(res.body.data.citationAccurate).toBe(false);
    });

    it('7. renders an ABSENT citationAccurate as null', async () => {
      fx.stubs.feedback.submitFeedback.mockReturnValue(of(wireFeedback()));

      const res = await authenticatedAgent(fx.app)
        .post(`${API}/messages/${messageId}/feedback`)
        .send({ rating: 1 });

      expect(res.body.data).toHaveProperty('citationAccurate', null);
    });

    it('8. maps an unreadable message to 404', async () => {
      fx.stubs.feedback.submitFeedback.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.NOT_FOUND, 'No message with that id'),
        ),
      );

      const res = await authenticatedAgent(fx.app)
        .post(`${API}/messages/${messageId}/feedback`)
        .send({ rating: 1 });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /messages/:messageId/feedback', () => {
    it('1. answers 204 with no body', async () => {
      fx.stubs.feedback.withdrawFeedback.mockReturnValue(of({}));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).delete(`${API}/messages/${messageId}/feedback`);

      expect(res.status).toBe(204);
    });

    it('2. takes NO user id — SELF is structural, not a parameter', async () => {
      // There is nowhere in this request to name another user, which is what
      // makes "only your own" hold without a permission check.
      fx.stubs.feedback.withdrawFeedback.mockReturnValue(of({}));

      await authenticatedAgent(fx.app).delete(
        `${API}/messages/${messageId}/feedback`,
      );

      const [request] = fx.stubs.feedback.withdrawFeedback.mock.calls[0];
      expect(Object.keys(request)).toEqual(['ticketMessageId']);
    });

    it('3. maps "you left none" to 404', async () => {
      fx.stubs.feedback.withdrawFeedback.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.NOT_FOUND, 'You have not left feedback'),
        ),
      );

      const res = await authenticatedAgent(fx.app).delete(
        `${API}/messages/${messageId}/feedback`,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('GET /feedback', () => {
    it('1. requires analytics.read, NOT ticket.read.all', async () => {
      // A quality-review surface aggregating what users thought of the model.
      // An agent who can work a queue has not thereby been granted the right to
      // read everyone's opinions of it.
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['ticket.read.all', 'ticket.message.moderate'],
      }).get(`${API}/feedback`);

      expect(res.status).toBe(403);
      expect(fx.stubs.feedback.listFeedback).not.toHaveBeenCalled();
    });

    it('2. lists for an analyst', async () => {
      fx.stubs.feedback.listFeedback.mockReturnValue(
        of({ items: [wireFeedback()], meta: wirePage([]).meta }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['analytics.read'],
      }).get(`${API}/feedback`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
    });

    it('3. sends rating 0 when NO rating filter is given', async () => {
      // The proto zero value, which the service reads as "no filter".
      fx.stubs.feedback.listFeedback.mockReturnValue(
        of({ items: [], meta: wirePage([]).meta }),
      );

      await authenticatedAgent(fx.app, {
        permissionCodes: ['analytics.read'],
      }).get(`${API}/feedback`);

      const [request] = fx.stubs.feedback.listFeedback.mock.calls[0];
      expect(request.rating).toBe(0);
    });

    it('4. forwards a rating filter as the number, not a string', async () => {
      fx.stubs.feedback.listFeedback.mockReturnValue(
        of({ items: [], meta: wirePage([]).meta }),
      );

      await authenticatedAgent(fx.app, {
        permissionCodes: ['analytics.read'],
      }).get(`${API}/feedback?rating=-1`);

      const [request] = fx.stubs.feedback.listFeedback.mock.calls[0];
      expect(request.rating).toBe(-1);
    });

    it('5. REJECTS a rating filter outside {1, -1}', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['analytics.read'],
      }).get(`${API}/feedback?rating=3`);

      expect(res.status).toBe(400);
    });

    it('6. forwards a date range as timestamps', async () => {
      fx.stubs.feedback.listFeedback.mockReturnValue(
        of({ items: [], meta: wirePage([]).meta }),
      );

      await authenticatedAgent(fx.app, { permissionCodes: ['analytics.read'] })
        .get(`${API}/feedback`)
        .query({
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-06-01T00:00:00.000Z',
        });

      const [request] = fx.stubs.feedback.listFeedback.mock.calls[0];
      expect(request.from).toBeDefined();
      expect(request.to).toBeDefined();
    });

    it('7. sends NO date filter when none is asked for', async () => {
      fx.stubs.feedback.listFeedback.mockReturnValue(
        of({ items: [], meta: wirePage([]).meta }),
      );

      await authenticatedAgent(fx.app, {
        permissionCodes: ['analytics.read'],
      }).get(`${API}/feedback`);

      const [request] = fx.stubs.feedback.listFeedback.mock.calls[0];
      expect(request.from).toBeUndefined();
      expect(request.to).toBeUndefined();
    });
  });

  describe('access', () => {
    it('1. refuses an ANONYMOUS caller on every route', async () => {
      const client = anonymousAgent(fx.app);

      expect(
        (
          await client
            .post(`${API}/messages/${messageId}/feedback`)
            .send({ rating: 1 })
        ).status,
      ).toBe(401);
      expect(
        (await client.delete(`${API}/messages/${messageId}/feedback`)).status,
      ).toBe(401);
      expect((await client.get(`${API}/feedback`)).status).toBe(401);
    });

    it('2. rejects a NON-UUID message id', async () => {
      const res = await authenticatedAgent(fx.app)
        .post(`${API}/messages/not-a-uuid/feedback`)
        .send({ rating: 1 });

      expect(res.status).toBe(400);
    });
  });
});
