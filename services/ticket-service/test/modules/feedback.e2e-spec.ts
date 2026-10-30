import { expectRpc } from '@synapsedesk/testing/rpc';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
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
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { FeedbackService } from '../../src/modules/feedback/feedback.service';

describe('AI feedback (e2e)', () => {
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

    it('1b. names the rated answer’s ticket', async () => {
      const { ticket, reply } = await seedAiReply();

      const result = await feedback.submitFeedback(
        { ticketMessageId: reply.id, rating: -1 },
        author(),
      );

      expect(result.ticketId).toBe(ticket.id);
      expect(result.ticketNumber).toBe(Number(ticket.ticketNumber));
    });

    it('2. UPDATES on a second submission — never a second row', async () => {
      // `(ticket_message_id, user_id)` is unique, so appending
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

  describe('getFeedback', () => {
    it("1. returns the caller's own row", async () => {
      const { reply } = await seedAiReply();
      await feedback.submitFeedback(
        { ticketMessageId: reply.id, rating: 1, feedbackText: 'Helpful' },
        author(),
      );

      const result = await feedback.getFeedback(
        { ticketMessageId: reply.id },
        author(),
      );

      expect(result.feedback?.rating).toBe(1);
      expect(result.feedback?.feedbackText).toBe('Helpful');
    });

    it('2. **an unrated message is ABSENT, not NOT_FOUND**', async () => {
      // The common answer. A client renders a thumb control on every AI message
      // and asks this per message, so a NOT_FOUND here would make the ordinary
      // state an error log.
      const { reply } = await seedAiReply();

      const result = await feedback.getFeedback(
        { ticketMessageId: reply.id },
        author(),
      );

      expect(result.feedback).toBeUndefined();
    });

    it("3. **one user cannot read another's rating**", async () => {
      // The user is never a parameter — it comes from the verified context, so
      // there is nothing to pass. This asserts the consequence: the analyst can
      // see the MESSAGE and still gets nothing for somebody else\'s row.
      const { reply } = await seedAiReply();
      await feedback.submitFeedback(
        { ticketMessageId: reply.id, rating: -1, feedbackText: 'Wrong' },
        author(),
      );

      const result = await feedback.getFeedback(
        { ticketMessageId: reply.id },
        analyst(),
      );

      expect(result.feedback).toBeUndefined();
    });

    it('4. **a message the caller cannot see is NOT_FOUND**', async () => {
      // Read through the MESSAGE, not by feedback id — a read starting at
      // `ai_response_feedbacks` would inherit none of the ticket\'s visibility.
      const other = buildTenant();
      const { reply } = await seedAiReply(other);

      await expectRpc(
        feedback.getFeedback({ ticketMessageId: reply.id }, author()),
        status.NOT_FOUND,
      );
    });

    it('5. an internal note is NOT_FOUND for a non-agent, and readable by one', async () => {
      const ticket = await createTicket(fx.prisma, tenant);
      const note = await createAiMessage(fx.prisma, ticket.id, {
        isInternalNote: true,
      });

      await expectRpc(
        feedback.getFeedback({ ticketMessageId: note.id }, author()),
        status.NOT_FOUND,
      );
      await expect(
        feedback.getFeedback({ ticketMessageId: note.id }, analyst()),
      ).resolves.toEqual({});
    });
  });

  describe('withdrawFeedback', () => {
    it('1. removes only the CALLER’S own row', async () => {
      // Two users rate the same message; one withdraws.
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

    it('7. **`searchTerm` filters on `feedbackText`, and a NULL row is not a match**', async () => {
      // `?searchTerm=` was advertised on this route and honoured by nobody
      // (known-gaps #6). `feedbackText` is the only free-text column here.
      //
      // **The null row is the part worth stating.** `feedbackText` is
      // `String?` — a rating submitted with no comment stores NULL — so it
      // cannot match a `contains`. That is correct rather than a gap: a text
      // search is a question about text, and a row with none is not a silent
      // omission. Asserted so the next reader does not read it as one.
      const ticket = await createTicket(fx.prisma, tenant);
      const seed = async (feedbackText: string | null) => {
        const message = await createAiMessage(fx.prisma, ticket.id);
        await fx.prisma.aiResponseFeedback.create({
          data: {
            ticketMessageId: message.id,
            userId: faker.string.uuid(),
            organizationId: tenant.organizationId,
            rating: -1,
            feedbackText,
          },
        });
      };

      await seed('The citation pointed at the WRONG policy document');
      await seed('Answer was fine');
      await seed(null);

      const { items, meta } = await feedback.listFeedback(
        // Lower case against upper-case text: the filter is insensitive, and a
        // caller does not know how the comment was typed.
        listRequest({ page: pageRequest({ searchTerm: 'wrong policy' }) }),
        analyst(),
      );

      expect(items).toHaveLength(1);
      expect(items[0].feedbackText).toContain('WRONG policy');
      // The same `where` counted the same rows — three exist, one matched.
      expect(meta!.totalItems).toBe(1);
    });

    it('8. each row names its ticket, so a dashboard row can open it; a row whose message is gone names none', async () => {
      const first = await seedAiReply();
      const second = await seedAiReply();
      const gone = await seedAiReply();
      for (const { reply } of [first, second, gone]) {
        await feedback.submitFeedback(
          { ticketMessageId: reply.id, rating: 1 },
          author(),
        );
      }
      await fx.prisma.ticketMessage.delete({ where: { id: gone.reply.id } });

      const { items } = await feedback.listFeedback(listRequest(), analyst());

      const byMessage = new Map(
        items.map((item) => [item.ticketMessageId, item]),
      );
      for (const { ticket, reply } of [first, second]) {
        expect(byMessage.get(reply.id)).toMatchObject({
          ticketId: ticket.id,
          ticketNumber: Number(ticket.ticketNumber),
        });
      }
      expect(byMessage.get(gone.reply.id)?.ticketId).toBeUndefined();
      expect(byMessage.get(gone.reply.id)?.ticketNumber).toBeUndefined();
    });

    it('9. **refuses a range longer than the organization’s analytics range**, as every analytics read does', async () => {
      jest
        .spyOn(fx.moduleRef.get(AuthReferenceService), 'getAnalyticsRangeDays')
        .mockResolvedValue(30);
      const day = (value: string) => toProtoTimestamp(new Date(value));

      const refused = feedback.listFeedback(
        listRequest({
          from: day('2026-05-01T00:00:00.000Z'),
          to: day('2026-05-31T23:59:59.000Z'),
        }),
        analyst(),
      );
      await expectRpc(refused, status.INVALID_ARGUMENT);
      await refused.catch((error: unknown) =>
        expect((error as RpcException).getError()).toMatchObject({
          message: 'Range is 31 days; the maximum is 30',
        }),
      );
      // Thirty days is the limit itself, and passes.
      await expect(
        feedback.listFeedback(
          listRequest({
            from: day('2026-05-01T00:00:00.000Z'),
            to: day('2026-05-30T23:59:59.000Z'),
          }),
          analyst(),
        ),
      ).resolves.toMatchObject({ items: [] });
    });
  });

  // -------------------------------------------------- cited-document read

  describe('listCitedDocumentFeedback', () => {
    const DOC_A = faker.string.uuid();
    const DOC_B = faker.string.uuid();
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const cite = (documentId: string) => ({
      chunkId: faker.string.uuid(),
      documentId,
      documentTitle: 'Handbook',
      pageNumber: null,
      vectorPointId: faker.string.uuid(),
    });

    /** An AI answer citing `documents`, rated by one person per rating. */
    const rated = async (
      documents: string[],
      ratings: Array<{
        rating: number;
        citationAccurate?: boolean;
        updatedAt?: Date;
      }>,
      t = tenant,
    ) => {
      const ticket = await createTicket(fx.prisma, t);
      const reply = await createAiMessage(fx.prisma, ticket.id, {
        citations: documents.map(cite),
      });
      for (const rating of ratings) {
        await fx.prisma.aiResponseFeedback.create({
          data: {
            ticketMessageId: reply.id,
            userId: faker.string.uuid(),
            organizationId: t.organizationId,
            rating: rating.rating,
            citationAccurate: rating.citationAccurate ?? null,
            ...(rating.updatedAt ? { updatedAt: rating.updatedAt } : {}),
          },
        });
      }
    };

    const read = (t = tenant) =>
      feedback.listCitedDocumentFeedback({
        organizationId: t.organizationId,
        since: toProtoTimestamp(since),
      });

    const byDocument = <T extends { documentId: string }>(items: T[]) =>
      Object.fromEntries(items.map((item) => [item.documentId, item]));

    it('counts each rating once per document its answer cited', async () => {
      // Two passages of A and one of B in one answer, rated down twice.
      await rated(
        [DOC_A, DOC_A, DOC_B],
        [{ rating: -1, citationAccurate: false }, { rating: -1 }],
      );
      await rated([DOC_A], [{ rating: 1 }]);

      const items = byDocument((await read()).items);

      expect(items[DOC_A]).toEqual({
        documentId: DOC_A,
        ratings: 3,
        downvotes: 2,
        inaccurate: 1,
      });
      expect(items[DOC_B]).toEqual({
        documentId: DOC_B,
        ratings: 2,
        downvotes: 2,
        inaccurate: 1,
      });
    });

    it('reads ratings changed inside the window only', async () => {
      await rated(
        [DOC_A],
        [
          { rating: -1, updatedAt: new Date(since.getTime() - 60_000) },
          { rating: -1, updatedAt: new Date(since.getTime() + 60_000) },
        ],
      );

      const items = byDocument((await read()).items);

      expect(items[DOC_A].ratings).toBe(1);
    });

    it('never counts another tenant’s ratings, or an answer with no citations', async () => {
      await rated([DOC_A], [{ rating: -1 }], buildTenant());
      await rated([], [{ rating: -1 }]);

      await expect(read()).resolves.toEqual({ items: [] });
    });

    it('refuses a read with no tenant or no window', async () => {
      await expectRpc(
        feedback.listCitedDocumentFeedback({
          organizationId: tenant.organizationId,
          since: undefined,
        }),
        status.INVALID_ARGUMENT,
      );
      await expectRpc(
        feedback.listCitedDocumentFeedback({
          organizationId: '',
          since: toProtoTimestamp(since),
        }),
        status.INVALID_ARGUMENT,
      );
    });
  });
});
