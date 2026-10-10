import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import {
  DocumentFlagResolution,
  DocumentFlagSeverity,
  DocumentFlagType,
  DocumentStatus,
} from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { memberContext, pageRequest } from '../utils/context';
import {
  buildTenant,
  createChunks,
  createDocument,
  createFlag,
  createScopedDocument,
  TenantFixture,
} from '../factories';
import { KnowledgeArticlesService } from '../../src/modules/knowledge-articles/knowledge-articles.service';

/**
 * The help centre, against a real database.
 *
 * Every property worth proving here is a `where` clause, and the definition has
 * three parts — visible, `INDEXED`, not soft-deleted. The third is the one that
 * disappears when someone reads `documentVisibility` as a complete rule.
 */
describe('Knowledge articles (e2e)', () => {
  let fx: E2eFixture;
  let articles: KnowledgeArticlesService;
  let tenant: TenantFixture;

  /** An END USER: no permissions, no departments. */
  const endUser = (t: TenantFixture = tenant) =>
    memberContext(
      { id: faker.string.uuid(), organizationId: t.organizationId },
      [],
      { departmentIds: [] },
    );

  const member = (t: TenantFixture = tenant) =>
    memberContext({ id: t.userId, organizationId: t.organizationId }, [], {
      departmentIds: [t.departmentId],
    });

  const listRequest = (overrides = {}) => ({
    page: pageRequest({ sortBy: 'updatedAt' }),
    ...overrides,
  });

  /** An INDEXED document with chunks — the only thing that is an article. */
  const article = async (
    overrides: Parameters<typeof createDocument>[2] = {},
    chunkCount = 3,
  ) => {
    const document = await createDocument(fx.prisma, tenant, {
      status: DocumentStatus.INDEXED,
      ...overrides,
    });
    await createChunks(fx.prisma, document, chunkCount);
    return document;
  };

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    articles = fx.moduleRef.get(KnowledgeArticlesService);
  }, 30_000);

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  describe('listKnowledgeArticles', () => {
    it('1. lists an org-wide INDEXED document to an end user with no departments', async () => {
      // The help-centre case end to end: `documentVisibility` resolves to
      // `isOrganizationWide: true` alone, which is the right default and needs
      // no new rule.
      const document = await article({ title: 'Leave Policy' });

      const page = await articles.listKnowledgeArticles(
        listRequest(),
        endUser(),
      );

      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        id: document.id,
        title: 'Leave Policy',
        chunkCount: 3,
      });
    });

    it('**2. EXCLUDES a document outside the caller’s departments**', async () => {
      const document = await createScopedDocument(
        fx.prisma,
        tenant,
        [tenant.departmentId],
        { status: DocumentStatus.INDEXED },
      );
      await createChunks(fx.prisma, document, 2);

      const page = await articles.listKnowledgeArticles(
        listRequest(),
        endUser(),
      );

      expect(page.items).toEqual([]);
      expect(page.meta?.totalItems).toBe(0);
    });

    it('3. a member of that department DOES see it', async () => {
      const document = await createScopedDocument(
        fx.prisma,
        tenant,
        [tenant.departmentId],
        { status: DocumentStatus.INDEXED },
      );
      await createChunks(fx.prisma, document, 2);

      const page = await articles.listKnowledgeArticles(
        listRequest(),
        member(),
      );

      expect(page.items.map((item) => item.id)).toEqual([document.id]);
    });

    it('**4. EXCLUDES PENDING and FAILED documents**', async () => {
      // A pipeline state is not a publication state — and neither has chunks
      // to read.
      await article({ status: DocumentStatus.PENDING });
      await article({ status: DocumentStatus.FAILED });
      const indexed = await article();

      const page = await articles.listKnowledgeArticles(
        listRequest(),
        endUser(),
      );

      expect(page.items.map((item) => item.id)).toEqual([indexed.id]);
    });

    it('**5. EXCLUDES a soft-deleted document, whose status is still INDEXED**', async () => {
      // The predicate that disappears. `deleteDocument` writes only
      // `softDeleteData`, so `status` stays INDEXED forever — "visible and
      // INDEXED" would list this to end users by title.
      const document = await article();
      await fx.prisma.document.update({
        where: { id: document.id },
        data: { deletedAt: new Date(), deletedById: tenant.userId },
      });

      const page = await articles.listKnowledgeArticles(
        listRequest(),
        endUser(),
      );

      expect(page.items).toEqual([]);
    });

    it('6. EXCLUDES another tenant’s articles', async () => {
      const stranger = buildTenant();
      const theirs = await createDocument(fx.prisma, stranger, {
        status: DocumentStatus.INDEXED,
      });
      await createChunks(fx.prisma, theirs, 1);

      const page = await articles.listKnowledgeArticles(
        listRequest(),
        endUser(),
      );

      expect(page.items).toEqual([]);
    });

    it('**7. HONOURS ?search= over titles**', async () => {
      // Searching titles is the first thing an end user does here, and the
      // filter is advertised — a dropped one answers a different question.
      await article({ title: 'Annual Leave Policy' });
      await article({ title: 'Expense Claims' });

      const page = await articles.listKnowledgeArticles(
        { page: pageRequest({ sortBy: 'updatedAt', searchTerm: 'leave' }) },
        endUser(),
      );

      expect(page.items.map((item) => item.title)).toEqual([
        'Annual Leave Policy',
      ]);
    });
  });

  describe('getKnowledgeArticle', () => {
    it('8. returns the article and a page of its text, in chunk order', async () => {
      const document = await article({}, 5);

      const detail = await articles.getKnowledgeArticle(
        { id: document.id, page: pageRequest({ limit: 2 }) },
        endUser(),
      );

      expect(detail.article?.title).toBe(document.title);
      expect(detail.blocks.map((block) => block.chunkIndex)).toEqual([0, 1]);
      // The meta counts BLOCKS, so a reader can page through the document.
      expect(detail.meta?.totalItems).toBe(5);
    });

    it('**8b. warns when pages could not be read, and stops warning once they can**', async () => {
      // The blocks are less than the document and nothing in them shows it —
      // `chunkIndex` is contiguous over what survived. And the signal has to
      // CLEAR: a warning that never does teaches readers to ignore the true one.
      const document = await article({}, 4);
      const flag = await createFlag(fx.prisma, document, {
        flagType: DocumentFlagType.PAGES_NOT_INDEXED,
        severity: DocumentFlagSeverity.WARNING,
      });

      const warned = await articles.getKnowledgeArticle(
        { id: document.id, page: pageRequest() },
        endUser(),
      );
      expect(warned.hasUnindexedPages).toBe(true);

      // Resolved — by anyone, human or the pipeline's own system resolution.
      await fx.prisma.documentFlag.update({
        where: { id: flag.id },
        data: {
          resolvedAt: new Date(),
          resolution: DocumentFlagResolution.FIXED,
        },
      });

      const clean = await articles.getKnowledgeArticle(
        { id: document.id, page: pageRequest() },
        endUser(),
      );
      expect(clean.hasUnindexedPages).toBe(false);
    });

    it('8c. a document with no such flag does not warn', async () => {
      const document = await article();

      const detail = await articles.getKnowledgeArticle(
        { id: document.id, page: pageRequest() },
        endUser(),
      );

      expect(detail.hasUnindexedPages).toBe(false);
    });

    it('**9. a document outside the caller’s departments is NOT_FOUND**', async () => {
      const document = await createScopedDocument(
        fx.prisma,
        tenant,
        [tenant.departmentId],
        { status: DocumentStatus.INDEXED },
      );
      await createChunks(fx.prisma, document, 2);

      await expectRpc(
        articles.getKnowledgeArticle(
          { id: document.id, page: pageRequest() },
          endUser(),
        ),
        status.NOT_FOUND,
      );
    });

    it('**10. a soft-deleted article is NOT_FOUND, and its text is not served**', async () => {
      const document = await article();
      await fx.prisma.document.update({
        where: { id: document.id },
        data: { deletedAt: new Date(), deletedById: tenant.userId },
      });

      await expectRpc(
        articles.getKnowledgeArticle(
          { id: document.id, page: pageRequest() },
          endUser(),
        ),
        status.NOT_FOUND,
      );
    });

    it('11. a PENDING document is NOT_FOUND', async () => {
      const document = await article({ status: DocumentStatus.PENDING });

      await expectRpc(
        articles.getKnowledgeArticle(
          { id: document.id, page: pageRequest() },
          endUser(),
        ),
        status.NOT_FOUND,
      );
    });

    it('12. an id that exists nowhere is the SAME error', async () => {
      await expectRpc(
        articles.getKnowledgeArticle(
          { id: faker.string.uuid(), page: pageRequest() },
          endUser(),
        ),
        status.NOT_FOUND,
      );
    });
  });
});
