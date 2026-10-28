import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import { expectRpc } from '@synapsedesk/testing/rpc';
import {
  DocumentStatus,
  IngestionErrorCode,
  IngestionJobStatus,
} from '@synapsedesk/contracts';
import {
  DocumentFileType,
  IngestionErrorCode as ProtoIngestionErrorCode,
  IngestionJobStatus as ProtoIngestionJobStatus,
  IngestionWaitingReason as ProtoIngestionWaitingReason,
  DocumentStatus as ProtoDocumentStatus,
} from '@synapsedesk/grpc-proto';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { memberContext, pageRequest } from '../utils/context';
import {
  buildTenant,
  createChunks,
  createDocument,
  createIngestionJob,
  TenantFixture,
} from '../factories';
import { AiAnalyticsService } from '../../src/modules/analytics/ai-analytics.service';
import { DocumentsService } from '../../src/modules/documents/documents.service';
import { IngestionJobsService } from '../../src/modules/ingestion-jobs/ingestion-jobs.service';
import { KnowledgeArticlesService } from '../../src/modules/knowledge-articles/knowledge-articles.service';

/**
 * A version being built beside the live one is invisible, and the document
 * it belongs to keeps answering as INDEXED.
 *
 * Every row here starts from a document with three live chunks and two staged
 * ones, which is what a reindex or replace looks like mid-run.
 */
describe('A staged version (e2e)', () => {
  let fx: E2eFixture;
  let tenant: TenantFixture;
  let documents: DocumentsService;
  let articles: KnowledgeArticlesService;
  let analytics: AiAnalyticsService;
  let jobs: IngestionJobsService;

  const manager = (t = tenant) =>
    memberContext(
      { id: t.userId, organizationId: t.organizationId },
      [
        'document.create',
        'document.update',
        'document.delete',
        'analytics.read',
      ],
      { departmentIds: [t.departmentId] },
    );

  const endUser = (t = tenant) =>
    memberContext(
      { id: faker.string.uuid(), organizationId: t.organizationId },
      [],
      { departmentIds: [] },
    );

  /** Three live chunks and two staged ones, on an INDEXED document. */
  const updating = async () => {
    const document = await createDocument(fx.prisma, tenant, {
      status: DocumentStatus.INDEXED,
    });
    await createChunks(fx.prisma, document, 3);
    const staged = await Promise.all(
      [0, 1].map((chunkIndex) =>
        fx.prisma.documentChunk.create({
          data: {
            documentId: document.id,
            chunkIndex,
            contentText: 'the next version, not yet live',
            tokenCount: 10,
            organizationId: document.organizationId,
            isOrganizationWide: document.isOrganizationWide,
            isStaged: true,
          },
        }),
      ),
    );

    return { document, staged };
  };

  const statusOf = async (documentId: string) =>
    (await fx.prisma.document.findUniqueOrThrow({ where: { id: documentId } }))
      .status;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    documents = fx.moduleRef.get(DocumentsService);
    articles = fx.moduleRef.get(KnowledgeArticlesService);
    analytics = fx.moduleRef.get(AiAnalyticsService);
    jobs = fx.moduleRef.get(IngestionJobsService);
  }, 30_000);

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  describe('every reader sees the live version only', () => {
    it('the passages list and its count', async () => {
      const { document } = await updating();

      const page = await documents.listDocumentChunks(
        { documentId: document.id, page: pageRequest() },
        manager(),
      );

      expect(page.items.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
      expect(page.meta?.totalItems).toBe(3);
    });

    it('a staged chunk read by id is NOT_FOUND', async () => {
      const { document, staged } = await updating();

      await expectRpc(
        documents.getDocumentChunk(
          { documentId: document.id, chunkId: staged[0].id },
          manager(),
        ),
        status.NOT_FOUND,
      );
    });

    it('the document’s chunk count', async () => {
      const { document } = await updating();

      const response = await documents.getDocument(
        { id: document.id },
        manager(),
      );

      expect(response.chunkCount).toBe(3);
    });

    it('the article’s blocks, its block count and the list’s count', async () => {
      const { document } = await updating();

      const detail = await articles.getKnowledgeArticle(
        { id: document.id, page: pageRequest() },
        endUser(),
      );
      const list = await articles.listKnowledgeArticles(
        { page: pageRequest({ sortBy: 'updatedAt' }) },
        endUser(),
      );

      expect(detail.blocks.map((block) => block.chunkIndex)).toEqual([0, 1, 2]);
      expect(detail.meta?.totalItems).toBe(3);
      expect(list.items[0].chunkCount).toBe(3);
    });

    it('a live passage’s position counts live blocks only', async () => {
      const { document } = await updating();
      const third = await fx.prisma.documentChunk.findFirstOrThrow({
        where: { documentId: document.id, chunkIndex: 2, isStaged: false },
      });

      const detail = await articles.getKnowledgeArticle(
        {
          id: document.id,
          page: pageRequest({ limit: 1 }),
          passage: third.id,
        },
        endUser(),
      );

      // Two live blocks before it; the two staged ones at 0 and 1 are not.
      expect(detail.meta?.currentPage).toBe(3);
      expect(detail.passageIndex).toBe(0);
    });

    it('the analytics chunk count', async () => {
      const { document } = await updating();

      const response = await analytics.getDocumentAnalytics(
        { limit: 10 },
        manager(),
      );

      const row = response.neverRetrieved.find(
        (item) => item.documentId === document.id,
      );
      expect(row?.chunkCount).toBe(3);
    });
  });

  describe('a document with a live version stays INDEXED', () => {
    it('when reindexed', async () => {
      const { document } = await updating();
      await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.COMPLETED,
      });

      await documents.reindexDocument({ id: document.id }, manager());

      await expect(statusOf(document.id)).resolves.toBe(DocumentStatus.INDEXED);
    });

    it('when its update is cancelled', async () => {
      const { document } = await updating();
      const running = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.EMBEDDING,
      });

      await jobs.cancelIngestionJob({ id: running.id }, manager());

      await expect(statusOf(document.id)).resolves.toBe(DocumentStatus.INDEXED);
    });

    it('when its failed update is retried', async () => {
      const { document } = await updating();
      const failed = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.FAILED,
      });

      await jobs.retryIngestionJob({ id: failed.id }, manager());

      await expect(statusOf(document.id)).resolves.toBe(DocumentStatus.INDEXED);
    });
  });

  describe('latestJob', () => {
    it('is the newest job, on a read and on a list', async () => {
      const { document } = await updating();
      await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.COMPLETED,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      });
      await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.FAILED,
        errorCode: IngestionErrorCode.PROVIDER_FAILURE,
        createdAt: new Date('2026-10-02T00:00:00Z'),
      });
      const failed = {
        status: ProtoIngestionJobStatus.INGESTION_JOB_STATUS_FAILED,
        waitingReason:
          ProtoIngestionWaitingReason.INGESTION_WAITING_REASON_UNSPECIFIED,
        errorCode:
          ProtoIngestionErrorCode.INGESTION_ERROR_CODE_PROVIDER_FAILURE,
      };

      const read = await documents.getDocument({ id: document.id }, manager());
      const list = await documents.listDocuments(
        {
          page: pageRequest(),
          status: ProtoDocumentStatus.DOCUMENT_STATUS_UNSPECIFIED,
          departmentId: '',
          fileType: DocumentFileType.DOCUMENT_FILE_TYPE_UNSPECIFIED,
          includeDeleted: false,
        },
        manager(),
      );

      expect(read.latestJob).toEqual(failed);
      expect(list.items[0].latestJob).toEqual(failed);
    });

    it('is absent when the document has no job', async () => {
      const { document } = await updating();

      const read = await documents.getDocument({ id: document.id }, manager());

      expect(read.latestJob).toBeUndefined();
    });
  });
});
