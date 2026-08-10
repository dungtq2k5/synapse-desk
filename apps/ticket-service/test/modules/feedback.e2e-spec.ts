import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import { toProtoTimestamp } from '@synapsedesk/grpc-proto';
import {
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
  pageRequest,
} from '../utils';
import {
  buildTenant,
  createAiMessage,
  createMessage,
  createTicket,
  TenantFixture,
} from '../factories';
import { FeedbackService } from '../../src/modules/feedback/feedback.service';

describe('§2.8 AI feedback (e2e)', () => {
  let fx: E2eFixture;
  let feedback: FeedbackService;

  let tenant: TenantFixture;

  const author = (t = tenant) =>
    memberContext({ id: t.userId, organizationId: t.organizationId });

  const analyst = (t = tenant) =>
    memberContext({ id: t.agentId, organizationId: t.organizationId }, [
      'ticket.read.all',
      'analytics.read',
    ]);

  /** A ticket with an AI reply on it — the thing feedback is about. */
  const seedAiReply = async (t = tenant) => {
    const ticket = await createTicket(fx.prisma, t);
    const reply = await createAiMessage(fx.prisma, ticket.id);
    return { ticket, reply };
  };

  const listRequest = (overrides: Record<string, unknown> = {}) => ({
    page: pageRequest(),
    rating: 0,
    citationAccurate: undefined,
    from: undefined,
    to: undefined,
    ...overrides,
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    feedback = fx.moduleRef.get(FeedbackService);
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();
    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  // -------------------------------------------------------------- upsert

  describe('submitFeedback', () => {
    it('1. records a thumbs-up', async () => {
      const { reply } = await seedAiReply();

      const result = await feedback.submitFeedback(
        {
          ticketMessageId: reply.id,
          rating: 1,
          feedbackText: undefined,
          citationAccurate: undefined,
        },
        author(),
      );

      expect(result.rating).toBe(1);
      expect(result.userId).toBe(tenant.userId);
      expect(result.organizationId).toBe(tenant.organizationId);
    });

    it('2. UPDATES on a second submission — never a second row', async () => {
      // §2.8 test 1. `(ticket_message_id, user_id)` is unique, so appending
      // would throw — but the real reason is the metric: a user who changes
      // their mind must be counted once, with the later opinion. Double
      // counting would make the number drift further from the truth the more
      // engaged the user was.
      const { reply } = await seedAiReply();

      const first = await feedback.submitFeedback(
        {
          ticketMessageId: reply.id,
          rating: 1,
          feedbackText: 'Helpful',
          citationAccurate: true,
        },
        author(),
      );
      const second = await feedback.submitFeedback(
        {
          ticketMessageId: reply.id,
          rating: -1,
          feedbackText: 'Actually wrong',
          citationAccurate: false,
        },
        author(),
      );

      const rows = await fx.prisma.aiResponseFeedback.findMany({
        where: { ticketMessageId: reply.id },
      });

      expect(rows).toHaveLength(1);
      expect(second.id).toBe(first.id);
      expect(rows[0].rating).toBe(-1);
      expect(rows[0].feedbackText).toBe('Actually wrong');
      expect(rows[0].citationAccurate).toBe(false);
    });

    it('3. keeps TWO users’ opinions on one message separate', async () => {
      // The uniqueness is per (message, USER). Collapsing it to per-message
      // would let the second rater silently overwrite the first.
      const { reply } = await seedAiReply();

      await feedback.submitFeedback(
        {
          ticketMessageId: reply.id,
          rating: 1,
          feedbackText: undefined,
          citationAccurate: undefined,
        },
        author(),
      );
      await feedback.submitFeedback(
        {
          ticketMessageId: reply.id,
          rating: -1,
          feedbackText: undefined,
          citationAccurate: undefined,
        },
        analyst(),
      );

      expect(
        await fx.prisma.aiResponseFeedback.count({
          where: { ticketMessageId: reply.id },
        }),
      ).toBe(2);
    });

    it('4. REFUSES a rating outside {1, -1}', async () => {
      const { reply } = await seedAiReply();

      for (const rating of [0, 2, -2, 5]) {
        await expectRpc(
          feedback.submitFeedback(
            {
              ticketMessageId: reply.id,
              rating,
              feedbackText: undefined,
              citationAccurate: undefined,
            },
            author(),
          ),
          status.INVALID_ARGUMENT,
        );
      }
    });

    it('5. stores an absent citationAccurate as NULL, not false', async () => {
      // Tri-state: "not assessed" is different from "assessed and wrong", and
      // collapsing them would make every un-assessed reply look like a citation
      // failure in the quality report.
      const { reply } = await seedAiReply();

      await feedback.submitFeedback(
        {
          ticketMessageId: reply.id,
          rating: 1,
          feedbackText: undefined,
          citationAccurate: undefined,
        },
        author(),
      );

      const row = await fx.prisma.aiResponseFeedback.findFirstOrThrow({
        where: { ticketMessageId: reply.id },
      });
      expect(row.citationAccurate).toBeNull();
    });

    it('6. normalizes whitespace-only text to NULL', async () => {
      const { reply } = await seedAiReply();

      await feedback.submitFeedback(
        {
          ticketMessageId: reply.id,
          rating: 1,
          feedbackText: '   ',
          citationAccurate: undefined,
        },
        author(),
      );

      const row = await fx.prisma.aiResponseFeedback.findFirstOrThrow({
        where: { ticketMessageId: reply.id },
      });
      expect(row.feedbackText).toBeNull();
    });

    it('7. answers NOT_FOUND for a message in ANOTHER tenant', async () => {
      // The row carries a denormalized `organization_id` taken from the caller.
      // Without this check somebody could stamp their own tenant onto a row
      // about another tenant's conversation.
      const { reply } = await seedAiReply();

      await expectRpc(
        feedback.submitFeedback(
          {
            ticketMessageId: reply.id,
            rating: 1,
            feedbackText: undefined,
            citationAccurate: undefined,
          },
          author(buildTenant()),
        ),
        status.NOT_FOUND,
      );

      expect(await fx.prisma.aiResponseFeedback.count()).toBe(0);
    });

    it('8. answers NOT_FOUND for an INTERNAL NOTE a non-agent cannot read', async () => {
      // Rating a note you cannot see would confirm it exists — the thread
      // filter undone through a different route.
      const ticket = await createTicket(fx.prisma, tenant);
      const note = await createMessage(fx.prisma, ticket.id, {
        isInternalNote: true,
      });

      await expectRpc(
        feedback.submitFeedback(
          {
            ticketMessageId: note.id,
            rating: 1,
            feedbackText: undefined,
            citationAccurate: undefined,
          },
          author(),
        ),
        status.NOT_FOUND,
      );
    });

    it('9. answers NOT_FOUND for a message id that does not exist', async () => {
      await expectRpc(
        feedback.submitFeedback(
          {
            ticketMessageId: faker.string.uuid(),
            rating: 1,
            feedbackText: undefined,
            citationAccurate: undefined,
          },
          author(),
        ),
        status.NOT_FOUND,
      );
    });
  });

  // ------------------------------------------------------------ withdraw

  describe('withdrawFeedback', () => {
    it('1. removes only the CALLER’S own row', async () => {
      // §2.8 test 3. Two users rate the same message; one withdraws.
      const { reply } = await seedAiReply();
      await feedback.submitFeedback(
        {
          ticketMessageId: reply.id,
          rating: 1,
          feedbackText: undefined,
          citationAccurate: undefined,
        },
        author(),
      );
      await feedback.submitFeedback(
        {
          ticketMessageId: reply.id,
          rating: -1,
          feedbackText: undefined,
          citationAccurate: undefined,
        },
        analyst(),
      );

      await feedback.withdrawFeedback({ ticketMessageId: reply.id }, author());

      const rows = await fx.prisma.aiResponseFeedback.findMany({
        where: { ticketMessageId: reply.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(tenant.agentId);
    });

    it('2. answers NOT_FOUND when the caller left none', async () => {
      const { reply } = await seedAiReply();

      await expectRpc(
        feedback.withdrawFeedback({ ticketMessageId: reply.id }, author()),
        status.NOT_FOUND,
      );
    });

    it('3. answers NOT_FOUND across tenants even with a real row', async () => {
      const { reply } = await seedAiReply();
      await feedback.submitFeedback(
        {
          ticketMessageId: reply.id,
          rating: 1,
          feedbackText: undefined,
          citationAccurate: undefined,
        },
        author(),
      );

      const impostor = memberContext({
        id: tenant.userId,
        organizationId: faker.string.uuid(),
      });

      await expectRpc(
        feedback.withdrawFeedback({ ticketMessageId: reply.id }, impostor),
        status.NOT_FOUND,
      );
      expect(await fx.prisma.aiResponseFeedback.count()).toBe(1);
    });

    it('4. is a HARD delete — withdrawn feedback stops counting', async () => {
      // Unlike almost everything else here. A soft-deleted row would have to be
      // excluded by every aggregate, which is a filter waiting to be forgotten
      // in one query — and the row is one user's opinion about a machine, not
      // something an audit trail needs.
      const { reply } = await seedAiReply();
      await feedback.submitFeedback(
        {
          ticketMessageId: reply.id,
          rating: 1,
          feedbackText: undefined,
          citationAccurate: undefined,
        },
        author(),
      );

      await feedback.withdrawFeedback({ ticketMessageId: reply.id }, author());

      expect(await fx.prisma.aiResponseFeedback.count()).toBe(0);
    });

    it('5. lets the caller rate AGAIN after withdrawing', async () => {
      const { reply } = await seedAiReply();
      const submit = (rating: number) =>
        feedback.submitFeedback(
          {
            ticketMessageId: reply.id,
            rating,
            feedbackText: undefined,
            citationAccurate: undefined,
          },
          author(),
        );

      await submit(1);
      await feedback.withdrawFeedback({ ticketMessageId: reply.id }, author());
      await submit(-1);

      const rows = await fx.prisma.aiResponseFeedback.findMany({
        where: { ticketMessageId: reply.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].rating).toBe(-1);
    });
  });

  // ---------------------------------------------------------------- list

  describe('listFeedback', () => {
    /** Seeds n rows in this tenant with the given rating. */
    const seedRows = async (
      entries: Array<{
        rating: number;
        citationAccurate?: boolean | null;
        createdAt?: Date;
      }>,
    ) => {
      const ticket = await createTicket(fx.prisma, tenant);
      for (const entry of entries) {
        const message = await createAiMessage(fx.prisma, ticket.id);
        await fx.prisma.aiResponseFeedback.create({
          data: {
            ticketMessageId: message.id,
            userId: faker.string.uuid(),
            organizationId: tenant.organizationId,
            rating: entry.rating,
            citationAccurate: entry.citationAccurate ?? null,
            ...(entry.createdAt ? { createdAt: entry.createdAt } : {}),
          },
        });
      }
    };

    it('1. is TENANT-SCOPED', async () => {
      await seedRows([{ rating: 1 }, { rating: -1 }]);

      const { items, meta } = await feedback.listFeedback(
        listRequest(),
        analyst(buildTenant()),
      );

      expect(items).toEqual([]);
      expect(meta!.totalItems).toBe(0);
    });

    it('2. filters by RATING', async () => {
      await seedRows([{ rating: 1 }, { rating: 1 }, { rating: -1 }]);

      const { items } = await feedback.listFeedback(
        listRequest({ rating: -1 }),
        analyst(),
      );

      expect(items).toHaveLength(1);
      expect(items[0].rating).toBe(-1);
    });

    it('3. treats rating 0 as NO FILTER, not as a rating', async () => {
      // 0 is the proto zero value. Reading it as a literal rating would return
      // nothing at all, and the caller would conclude there was no feedback.
      await seedRows([{ rating: 1 }, { rating: -1 }]);

      const { items } = await feedback.listFeedback(
        listRequest({ rating: 0 }),
        analyst(),
      );

      expect(items).toHaveLength(2);
    });

    it('4. filters by citationAccurate, distinguishing FALSE from unset', async () => {
      await seedRows([
        { rating: 1, citationAccurate: true },
        { rating: 1, citationAccurate: false },
        { rating: 1, citationAccurate: null },
      ]);

      const accurate = await feedback.listFeedback(
        listRequest({ citationAccurate: true }),
        analyst(),
      );
      const inaccurate = await feedback.listFeedback(
        listRequest({ citationAccurate: false }),
        analyst(),
      );

      expect(accurate.items).toHaveLength(1);
      // One row, not two: the un-assessed row must NOT be swept in with the
      // one somebody actually judged wrong.
      expect(inaccurate.items).toHaveLength(1);
    });

    it('5. filters by a date RANGE, inclusive of the end day', async () => {
      // `lte`, not `lt`: a caller asking for "up to the 5th" means the whole of
      // the 5th, and `lt` would silently drop that day's rows.
      const old = new Date('2026-01-01T00:00:00.000Z');
      const boundary = new Date('2026-06-01T12:00:00.000Z');
      await seedRows([
        { rating: 1, createdAt: old },
        { rating: 1, createdAt: boundary },
      ]);

      const { items } = await feedback.listFeedback(
        listRequest({
          from: toProtoTimestamp(new Date('2026-05-01T00:00:00.000Z')),
          to: toProtoTimestamp(boundary),
        }),
        analyst(),
      );

      expect(items).toHaveLength(1);
    });

    it('6. counts with the SAME filter it lists with', async () => {
      await seedRows([{ rating: 1 }, { rating: 1 }, { rating: -1 }]);

      const { items, meta } = await feedback.listFeedback(
        listRequest({ rating: 1 }),
        analyst(),
      );

      expect(meta!.totalItems).toBe(items.length);
      expect(meta!.totalItems).toBe(2);
    });
  });
});
