import { randomUUID } from 'node:crypto';
import { PERMISSION_CODES } from '@synapsedesk/contracts';
import { pageRequest } from '@synapsedesk/grpc-proto/testing/page';
import {
  CLEAN,
  controllerCall,
  type IdTakingMethod,
  idTakingMethods,
  probeCall,
  snapshot,
  tenantIdentifiers,
  wireRequest,
} from '@synapsedesk/grpc-proto/testing/tenant-probe';
import { memberContext } from '@synapsedesk/testing/context';
import { E2eFixture, bootstrapE2eTest } from '../utils/bootstrap';
import {
  buildTenant,
  createChunks,
  createFlag,
  createIngestionJob,
  createScopedDocument,
} from '../factories';
import { DocumentsGrpcController } from '../../src/modules/documents/documents-grpc.controller';
import { AiLedgerGrpcController } from '../../src/modules/ai-ledger/ai-ledger-grpc.controller';
import { PlatformGrpcController } from '../../src/modules/platform/platform-grpc.controller';

/**
 * **The cross-tenant probe**: every RPC that takes an id, called by tenant
 * B's most privileged member on tenant A's ids, answers as it does for an id
 * that doesn't exist, names nothing of A's, and leaves A's rows as they were.
 *
 * The RPC list comes from the proto files (`idTakingMethods`), and the first
 * row holds this table to it: a new id-taking RPC fails here until it says
 * how to call it.
 */
describe('Cross-tenant probe: ingestion-service (e2e)', () => {
  let fx: E2eFixture;
  let controllers: Record<string, object>;

  const B = buildTenant();
  const asB = memberContext(
    { id: B.userId, organizationId: B.organizationId },
    [...PERMISSION_CODES],
    { departmentIds: [B.departmentId] },
  );

  type A = Awaited<ReturnType<typeof seedA>>;

  /** Tenant A with one of everything this service stores. */
  async function seedA() {
    const tenant = buildTenant();
    const document = await createScopedDocument(
      fx.prisma,
      tenant,
      [tenant.departmentId],
      {
        status: 'INDEXED',
      },
    );
    await createChunks(fx.prisma, document, 1, [tenant.departmentId]);
    const chunk = await fx.prisma.documentChunk.findFirstOrThrow({
      where: { documentId: document.id },
    });
    const flag = await createFlag(fx.prisma, document);
    const job = await createIngestionJob(fx.prisma, tenant, document.id, {
      status: 'FAILED',
    });
    const ticket = randomUUID();
    const generation = await fx.prisma.aiGeneration.create({
      data: {
        organizationId: tenant.organizationId,
        ticketId: ticket,
        purpose: 'DRAFT',
        modelName: 'model-a',
        retrievedChunkIds: [chunk.id],
        citedChunkIds: [chunk.id],
      },
    });
    await fx.prisma.aiGenerationDailyStat.create({
      data: {
        organizationId: tenant.organizationId,
        day: new Date('2026-11-01'),
        purpose: 'DRAFT',
        modelName: 'model-a',
        generations: 1,
      },
    });
    await fx.prisma.limitAlertGeneration.create({
      data: {
        organizationId: tenant.organizationId,
        dimension: 'STORAGE',
        generation: 1,
      },
    });

    return {
      ...tenant,
      document: document.id,
      objectPath: document.fileUrl,
      chunk: chunk.id,
      flag: flag.id,
      job: job.id,
      ticket,
      generation: generation.id,
    };
  }

  type Row =
    | {
        build: (a: A) => Record<string, unknown>;
        /** The finding this row holds as a known failure until the scoped client closes it. */
        knownFailure?: string;
      }
    | { exempt: string };

  const byId = (a: A) => ({ id: a.document });

  /** How to call each id-taking RPC with A's ids. */
  const PROBE: Record<string, Row> = {
    'DocumentService/ListDocumentsByIds': {
      build: (a) => ({ documentIds: [a.document] }),
    },
    'DocumentService/ListDocumentChunksByIds': {
      build: (a) => ({ chunkIds: [a.chunk] }),
    },
    'DocumentService/PresignDocument': {
      build: (a) => ({
        contentType: 'application/pdf',
        sizeBytes: 1024,
        fileName: 'handbook.pdf',
        replaceDocumentId: a.document,
      }),
    },
    'DocumentService/ConfirmDocument': {
      build: (a) => ({
        objectPath: a.objectPath,
        title: 'B’s copy',
        isOrganizationWide: false,
        departmentIds: [a.departmentId],
        fileName: 'handbook.pdf',
      }),
    },
    'DocumentService/ListDocuments': {
      build: (a) => ({
        page: pageRequest(),
        departmentId: a.departmentId,
        includeDeleted: true,
      }),
    },
    'DocumentService/GetDocument': { build: byId },
    'DocumentService/UpdateDocument': {
      build: (a) => ({
        id: a.document,
        title: 'B was here',
        isOrganizationWide: true,
      }),
    },
    'DocumentService/DeleteDocument': { build: byId },
    'DocumentService/RestoreDocument': { build: byId },
    'DocumentService/DownloadDocument': { build: byId },
    'DocumentService/ReindexDocument': { build: byId },
    'DocumentService/ReplaceDocument': {
      build: (a) => ({ id: a.document, objectPath: a.objectPath }),
    },
    'DocumentService/ListDocumentDepartments': { build: byId },
    'DocumentService/SetDocumentDepartments': {
      build: (a) => ({ id: a.document, departmentIds: [a.departmentId] }),
    },
    'DocumentService/ListDocumentChunks': {
      build: (a) => ({ documentId: a.document, page: pageRequest() }),
    },
    'DocumentService/GetDocumentChunk': {
      build: (a) => ({ documentId: a.document, chunkId: a.chunk }),
    },
    'DocumentService/ListDocumentFlags': {
      build: (a) => ({
        documentId: a.document,
        includeResolved: true,
        page: pageRequest(),
      }),
    },
    'DocumentService/GetDocumentFlag': { build: (a) => ({ id: a.flag }) },
    'DocumentService/GetKnowledgeArticle': {
      build: (a) => ({ id: a.document, page: pageRequest() }),
    },
    'DocumentService/ResolveDocumentFlag': {
      build: (a) => ({ id: a.flag, resolution: 1, comment: 'B was here' }),
    },
    'DocumentService/DeleteDocumentFlag': { build: (a) => ({ id: a.flag }) },
    // The id is ignored: the usage read is the caller's own tenant's.
    'DocumentService/GetStorageUsage': { build: byId },
    'DocumentService/ListIngestionJobs': {
      build: (a) => ({ documentId: a.document, page: pageRequest() }),
    },
    'DocumentService/GetIngestionJob': { build: (a) => ({ id: a.job }) },
    'DocumentService/RetryIngestionJob': { build: (a) => ({ id: a.job }) },
    'DocumentService/CancelIngestionJob': { build: (a) => ({ id: a.job }) },
    'DocumentService/ListDocumentIngestionJobs': { build: byId },
    'AiLedgerService/RecordGeneration': {
      // Service-to-service: the tenant is the request field. B naming its own
      // tenant must not record a generation that cites A's chunks.
      build: (a) => ({
        organizationId: B.organizationId,
        userId: a.userId,
        ticketId: a.ticket,
        purpose: 'DRAFT',
        modelName: 'model-b',
        status: 'SUCCESS',
        retrievedChunkIds: [a.chunk],
        citedChunkIds: [a.chunk],
      }),
    },
    'AiLedgerService/RecordGenerationOutcome': {
      build: (a) => ({
        generationId: a.generation,
        resultingMessageId: randomUUID(),
        sentText: 'x',
        ticketId: a.ticket,
      }),
    },
    'IngestionPlatformService/GetPlatformUsage': {
      build: (a) => ({ organizationIds: [a.organizationId] }),
    },
  };

  const methods = idTakingMethods('ingestion');

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    controllers = {
      DocumentService: fx.moduleRef.get(DocumentsGrpcController),
      AiLedgerService: fx.moduleRef.get(AiLedgerGrpcController),
      IngestionPlatformService: fx.moduleRef.get(PlatformGrpcController),
    };
  });

  afterAll(async () => fx.close());

  beforeEach(async () => fx.reset());

  it('**no row is a known failure**: every cross-tenant reach found here is closed', () => {
    expect(
      Object.keys(PROBE).filter((name) => 'knownFailure' in PROBE[name]),
    ).toEqual([]);
  });

  it('**every id-taking RPC has a row**, and no row names an RPC that is gone', () => {
    expect(Object.keys(PROBE).sort()).toEqual(
      methods.map((m) => m.name).sort(),
    );
  });

  const probe = async (name: string, method: IdTakingMethod) => {
    const a = await seedA();
    // A's rows here, plus values that are A's data without being ids.
    const local = new Set([
      ...tenantIdentifiers(await snapshot(fx.prisma), a.organizationId),
      a.objectPath,
    ]);
    const foreign = new Set([a.userId, a.departmentId, a.ticket]);
    const row = PROBE[name] as { build: (a: A) => Record<string, unknown> };

    const report = await probeCall({
      request: wireRequest(method, row.build(a)),
      call: controllerCall(controllers, name, asB),
      local,
      foreign,
      prisma: fx.prisma,
    });

    expect(report).toEqual({
      ...CLEAN,
      onA: report.onA,
      onMissing: report.onMissing,
    });
  };

  it.each(
    methods
      .filter((method) => 'build' in PROBE[method.name])
      .map((method) => [method.name, method] as const),
  )(
    '**%s** as tenant B on A’s ids: answers as for a missing id, names nothing of A’s, changes nothing of A’s',
    probe,
  );
});
