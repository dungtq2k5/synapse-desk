import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  AnswerStatus,
  compareAlphabetically,
  withHttpStatus,
} from '@synapsedesk/common';
import {
  AnswerStatus as ProtoAnswerStatus,
  SearchDegradation,
} from '@synapsedesk/grpc-proto';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';
import { grpcError, timestamp, wirePage } from '../fixtures/wire';

/**
 * `/knowledge/ask` at the HTTP boundary.
 *
 * The route is a thin adapter over a finished RPC, so what is worth asserting
 * is the boundary itself: what reaches the peer, what comes back, and the two
 * places this surface deliberately differs from `search`.
 */
describe('Knowledge ask at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const wireAnswer = (overrides: Record<string, unknown> = {}) => ({
    content: 'Twelve days, and five may carry over.',
    status: ProtoAnswerStatus.ANSWER_STATUS_DOC_ANSWER,
    citations: [
      {
        chunkId: faker.string.uuid(),
        documentId: faker.string.uuid(),
        documentTitle: 'Leave Policy 2026',
        pageNumber: 3,
        vectorPointId: faker.string.uuid(),
      },
    ],
    generationId: faker.string.uuid(),
    ...overrides,
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  }, 30_000);

  beforeEach(() => jest.clearAllMocks());

  afterAll(() => fx.close());

  it('1. returns the answer, its citations and the generation id', async () => {
    const wire = wireAnswer();
    fx.stubs.rag.ask.mockReturnValue(of(wire));

    const res = await authenticatedAgent(fx.app)
      .post(`${API}/knowledge/ask`)
      .send({
        message: 'How many leave days do I get?',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe(wire.content);
    expect(res.body.data.status).toBe(AnswerStatus.DOC_ANSWER);
    expect(res.body.data.generationId).toBe(wire.generationId);
    expect(res.body.data.citations[0]).toMatchObject({
      documentTitle: 'Leave Policy 2026',
      pageNumber: 3,
    });
  });

  it('**2. sends NO ticketId and an EMPTY history — the attribution and the one-shot rule**', async () => {
    // `ticket_id` absent is what makes the ledger row `CHAT_ANSWER` with
    // `ticket_id = NULL`. Empty history is what keeps this one question rather
    // than an unbounded thread metered against no ticket.
    fx.stubs.rag.ask.mockReturnValue(of(wireAnswer()));

    await authenticatedAgent(fx.app)
      .post(`${API}/knowledge/ask`)
      .send({ message: 'anything' });

    const [[request]] = fx.stubs.rag.ask.mock.calls;
    expect(request.ticketId).toBeUndefined();
    expect(request.history).toEqual([]);
    expect(request.attachments).toEqual([]);
  });

  it('**2b. a client cannot SMUGGLE history or a ticketId past the DTO**', async () => {
    // The DTO carries one field, and `forbidNonWhitelisted` refuses the rest
    // outright rather than dropping them quietly — so an attempt to turn this
    // into a multi-turn thread, or to bill it to a ticket, is a 400 rather than
    // a request the gateway silently sanitizes.
    const res = await authenticatedAgent(fx.app)
      .post(`${API}/knowledge/ask`)
      .send({
        message: 'anything',
        ticketId: faker.string.uuid(),
        history: [{ role: 'user', content: 'earlier' }],
      });

    expect(res.status).toBe(400);
    expect(fx.stubs.rag.ask).not.toHaveBeenCalled();
  });

  it('**3. the AI cap is 402, not 403**', async () => {
    // `PERMISSION_DENIED` maps to 403 by the code table; the `[http:402]`
    // marker overrides it. Without that a billing limit sends an admin
    // hunting role grants.
    fx.stubs.rag.ask.mockReturnValue(
      throwError(() =>
        grpcError(
          GrpcStatus.PERMISSION_DENIED,
          withHttpStatus(402, 'This workspace has used its AI allowance'),
        ),
      ),
    );

    const res = await authenticatedAgent(fx.app)
      .post(`${API}/knowledge/ask`)
      .send({ message: 'anything' });

    expect(res.status).toBe(402);
    // And the marker is stripped, not shown to the user.
    expect(res.body.error).not.toContain('[http:');
    expect(res.body.error).toContain('AI allowance');
  });

  it('4. DOC_MISSING comes back as a status, not as invented prose', async () => {
    fx.stubs.rag.ask.mockReturnValue(
      of(
        wireAnswer({
          status: ProtoAnswerStatus.ANSWER_STATUS_DOC_MISSING,
          citations: [],
        }),
      ),
    );

    const res = await authenticatedAgent(fx.app)
      .post(`${API}/knowledge/ask`)
      .send({ message: 'what is our policy on time travel' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(AnswerStatus.DOC_MISSING);
    expect(res.body.data.citations).toEqual([]);
  });

  it('5. is reachable by an END USER holding no permissions', async () => {
    // The whole point of the surface: self-service before a ticket exists.
    fx.stubs.rag.ask.mockReturnValue(of(wireAnswer()));

    const res = await authenticatedAgent(fx.app, { permissionCodes: [] })
      .post(`${API}/knowledge/ask`)
      .send({ message: 'anything' });

    expect(res.status).toBe(200);
  });

  it('6. REJECTS an empty question before reaching the peer', async () => {
    const res = await authenticatedAgent(fx.app)
      .post(`${API}/knowledge/ask`)
      .send({ message: '   ' });

    expect(res.status).toBe(400);
    expect(fx.stubs.rag.ask).not.toHaveBeenCalled();
  });

  describe('POST /knowledge/search — the degradation marker', () => {
    // The marker is the only thing telling a caller "thinner because AI spend
    // was unavailable" from "thinner because the corpus is". No test read it
    // at this boundary before; the mapper could answer null forever.
    const searchWith = async (degraded: SearchDegradation) => {
      fx.stubs.rag.search.mockReturnValue(of({ chunks: [], degraded }));

      return authenticatedAgent(fx.app)
        .post(`${API}/knowledge/search`)
        .send({ query: 'leave policy' });
    };

    it('LEXICAL_ONLY on the wire is `LEXICAL_ONLY` in the response', async () => {
      const res = await searchWith(
        SearchDegradation.SEARCH_DEGRADATION_LEXICAL_ONLY,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.degraded).toBe('LEXICAL_ONLY');
    });

    it('UNSPECIFIED on the wire is `null` — a normal search is not degraded', async () => {
      const res = await searchWith(
        SearchDegradation.SEARCH_DEGRADATION_UNSPECIFIED,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.degraded).toBeNull();
    });
  });

  describe('the help centre', () => {
    const wireArticle = (overrides: Record<string, unknown> = {}) => ({
      id: faker.string.uuid(),
      title: 'Leave Policy 2026',
      updatedAt: timestamp(),
      chunkCount: 12,
      ...overrides,
    });

    it('**7. the article response carries NO file or ownership fields**', async () => {
      // §2's whole argument, asserted on the ABSENCE.
      //
      // The peer is stubbed sending the WIDE shape on purpose — that is what
      // arrives the day someone "simplifies" the narrow RPC into a filtered
      // `ListDocuments`. Asserting against a stub that already sends four
      // fields would only prove the mapper adds nothing.
      fx.stubs.document.listKnowledgeArticles.mockReturnValue(
        of(
          wirePage([
            wireArticle({
              fileUrl: 'organizations/x/documents/y/handbook.pdf',
              fileHash: 'deadbeef',
              fileSizeBytes: 1024,
              createdById: faker.string.uuid(),
              status: 3,
            }),
          ]),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/knowledge/articles`);

      expect(res.status).toBe(200);
      const [article] = res.body.data.items as Record<string, unknown>[];
      expect(Object.keys(article).sort(compareAlphabetically)).toEqual(
        ['chunkCount', 'id', 'title', 'updatedAt'].sort(compareAlphabetically),
      );
    });

    it('8. is reachable by an END USER holding no permissions', async () => {
      // The audience the routes exist for: self-service before a ticket.
      fx.stubs.document.listKnowledgeArticles.mockReturnValue(
        of(wirePage([wireArticle()])),
      );

      const res = await authenticatedAgent(fx.app, { permissionCodes: [] }).get(
        `${API}/knowledge/articles`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.meta).toBeDefined();
    });

    it('9. forwards ?searchTerm= — the filter is honoured, not dropped', async () => {
      fx.stubs.document.listKnowledgeArticles.mockReturnValue(of(wirePage([])));

      await authenticatedAgent(fx.app, { permissionCodes: [] })
        .get(`${API}/knowledge/articles`)
        .query({ searchTerm: 'leave' });

      const [[request]] = fx.stubs.document.listKnowledgeArticles.mock.calls;
      expect(request.page).toMatchObject({
        searchTerm: 'leave',
        // The list's own default, not the base `createdAt` — which the service
        // does not allowlist and would 400 on.
        sortBy: 'updatedAt',
      });
    });

    it('**10. the detail route asks for a BLOCK range in reading order**', async () => {
      fx.stubs.document.getKnowledgeArticle.mockReturnValue(
        of({
          article: wireArticle(),
          blocks: [
            { chunkIndex: 0, pageNumber: 1, contentText: 'Twelve days.' },
            {
              chunkIndex: 1,
              pageNumber: undefined,
              contentText: 'Carry over.',
            },
          ],
          meta: wirePage([]).meta,
          hasUnindexedPages: false,
        }),
      );
      const articleId = faker.string.uuid();

      const res = await authenticatedAgent(fx.app, { permissionCodes: [] })
        .get(`${API}/knowledge/articles/${articleId}`)
        .query({ limit: 2 });

      expect(res.status).toBe(200);
      expect(res.body.data.article.title).toBe('Leave Policy 2026');
      expect(res.body.data.hasUnindexedPages).toBe(false);
      expect(res.body.data.blocks[0].contentText).toBe('Twelve days.');
      // Absent page number is null, never faked as 1.
      expect(res.body.data.blocks[1].pageNumber).toBeNull();

      const [[request]] = fx.stubs.document.getKnowledgeArticle.mock.calls;
      expect(request).toMatchObject({ id: articleId });
      // **No `sortBy` on the wire.** The service supplies the column from its
      // own allowlist; naming it here would be a second literal that has to
      // agree with `DOCUMENT_CHUNK_SORTABLE_FIELDS` forever, and `toPrismaPage`
      // throws rather than falling back when two such literals drift.
      // The ordering itself is asserted service-side, where it is applied.
      expect(request.page).toMatchObject({ sortBy: '', limit: 2 });
    });

    it('**10b. surfaces the incomplete-source warning to the reader**', async () => {
      // The blocks look complete — `chunkIndex` is contiguous over what
      // survived — so this flag is the only thing that says otherwise.
      fx.stubs.document.getKnowledgeArticle.mockReturnValue(
        of({
          article: wireArticle(),
          blocks: [{ chunkIndex: 0, pageNumber: 1, contentText: 'Partial.' }],
          meta: wirePage([]).meta,
          hasUnindexedPages: true,
        }),
      );

      const res = await authenticatedAgent(fx.app, { permissionCodes: [] }).get(
        `${API}/knowledge/articles/${faker.string.uuid()}`,
      );

      expect(res.body.data.hasUnindexedPages).toBe(true);
    });

    it('11. REJECTS a non-UUID article id before reaching the peer', async () => {
      const res = await authenticatedAgent(fx.app, { permissionCodes: [] }).get(
        `${API}/knowledge/articles/not-a-uuid`,
      );

      expect(res.status).toBe(400);
      expect(fx.stubs.document.getKnowledgeArticle).not.toHaveBeenCalled();
    });

    it('**12. the blocks query advertises no searchTerm to drop**', async () => {
      // It does not extend `SearchPaginationDto`, so an unknown property is a
      // 400 rather than a filter this route would silently ignore.
      const res = await authenticatedAgent(fx.app, { permissionCodes: [] })
        .get(`${API}/knowledge/articles/${faker.string.uuid()}`)
        .query({ searchTerm: 'anything' });

      expect(res.status).toBe(400);
      expect(fx.stubs.document.getKnowledgeArticle).not.toHaveBeenCalled();
    });
  });
});
