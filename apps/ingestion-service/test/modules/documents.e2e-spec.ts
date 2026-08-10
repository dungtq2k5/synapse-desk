import { RpcException } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import {
  BATCH_CHUNK_LIMIT,
  BATCH_ID_LIMIT,
  DOCUMENT_PATTERNS,
  DocumentFlagSeverity,
  DocumentFlagType,
  DocumentStatus,
  IngestionJobStatus,
} from '@synapsedesk/common';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import {
  E2eFixture,
  bootstrapE2eTest,
  memberContext,
  pageRequest,
} from '../utils';
import {
  buildTenant,
  createChunks,
  createDocument,
  createFlag,
  createScopedDocument,
  TenantFixture,
} from '../factories';
import { DocumentsService } from '../../src/modules/documents/documents.service';
import { QdrantService } from '../../src/modules/qdrant/qdrant.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { StorageReferenceService } from '../../src/modules/storage-client/storage-reference.service';
import { DocumentEventPublisher } from '../../src/modules/events/document-event.publisher';
import { faultInjector } from '@synapsedesk/common/testing/fault';

describe('§2 Documents (e2e)', () => {
  // Every injected fault in this file is registered here and restored in an
  // `afterEach` that runs whether the test passed, failed or threw — 16-doc §9.
  const faults = faultInjector();

  let fx: E2eFixture;
  let documents: DocumentsService;
  let qdrant: QdrantService;
  let authReference: AuthReferenceService;
  let storage: StorageReferenceService;
  let events: DocumentEventPublisher;

  let getStorageLimitBytes: jest.SpyInstance;
  let assertDepartmentsExist: jest.SpyInstance;
  let presignDocument: jest.SpyInstance;
  let confirmUpload: jest.SpyInstance;
  let resolveReadUrls: jest.SpyInstance;
  let publish: jest.SpyInstance;

  let tenant: TenantFixture;

  /** 5 GB — the RDM default for `max_storage_bytes`. */
  const DEFAULT_STORAGE_LIMIT = 5 * 1024 * 1024 * 1024;

  /** A knowledge manager: may upload, and belongs to one department. */
  const manager = (t = tenant) =>
    memberContext(
      { id: t.userId, organizationId: t.organizationId },
      ['document.create', 'document.update', 'document.delete'],
      { departmentIds: [t.departmentId] },
    );

  /** A member of NO department — sees only organization-wide documents. */
  const outsider = (t = tenant) =>
    memberContext(
      { id: faker.string.uuid(), organizationId: t.organizationId },
      [],
      {
        departmentIds: [],
      },
    );

  const presignRequest = (overrides: Record<string, unknown> = {}) => ({
    contentType: 'application/pdf',
    sizeBytes: 2048,
    fileName: 'handbook.pdf',
    ...overrides,
  });

  const confirmRequest = (overrides: Record<string, unknown> = {}) => ({
    objectPath: `organizations/${tenant.organizationId}/documents/${faker.string.uuid()}/x.pdf`,
    title: '2026 Employee Handbook',
    isOrganizationWide: true,
    departmentIds: [] as string[],
    fileName: 'handbook.pdf',
    ...overrides,
  });

  const listRequest = (overrides: Record<string, unknown> = {}) => ({
    page: pageRequest(),
    status: '',
    departmentId: '',
    fileType: '',
    includeDeleted: false,
    ...overrides,
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    documents = fx.moduleRef.get(DocumentsService);
    qdrant = fx.moduleRef.get(QdrantService);
    authReference = fx.moduleRef.get(AuthReferenceService);
    storage = fx.moduleRef.get(StorageReferenceService);
    events = fx.moduleRef.get(DocumentEventPublisher);

    // auth-service, storage-service and NATS are not running for this suite.
    // Each has its own coverage — the storage suite for presign/confirm, and
    // the validation failures below for the auth boundary.
    getStorageLimitBytes = jest.spyOn(authReference, 'getStorageLimitBytes');
    assertDepartmentsExist = jest.spyOn(
      authReference,
      'assertDepartmentsExist',
    );
    presignDocument = jest.spyOn(storage, 'presignDocument');
    confirmUpload = jest.spyOn(storage, 'confirmUpload');
    resolveReadUrls = jest.spyOn(storage, 'resolveReadUrls');
    publish = jest.spyOn(events, 'publish').mockImplementation(() => {});
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();

    // Re-stated every test: `clearAllMocks` resets call records but keeps
    // implementations, so one test's override would leak into every later one.
    getStorageLimitBytes.mockResolvedValue(DEFAULT_STORAGE_LIMIT);
    assertDepartmentsExist.mockResolvedValue(undefined);
    presignDocument.mockImplementation(
      (input: { documentId: string; contentType: string }) =>
        Promise.resolve({
          uploadUrl: 'https://storage.example/signed-put',
          objectPath: `organizations/${tenant.organizationId}/documents/${input.documentId}/${faker.string.uuid()}.pdf`,
          expiresAt: new Date(Date.now() + 600_000),
        }),
    );
    confirmUpload.mockResolvedValue({
      sizeBytes: 2048,
      contentType: 'application/pdf',
    });
    resolveReadUrls.mockImplementation((paths: string[]) =>
      Promise.resolve(
        Object.fromEntries(
          paths.map((path) => [path, `https://signed/${path}`]),
        ),
      ),
    );

    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  // ------------------------------------------------------------- §2.1 upload

  describe('presign', () => {
    it('1. returns an upload URL for a tenant under quota', async () => {
      const result = await documents.presignDocument(
        presignRequest(),
        manager(),
      );

      expect(result.uploadUrl).toBeTruthy();
      expect(result.objectPath).toContain(tenant.organizationId);
      expect(result.expiresAt).toBeDefined();
    });

    it('2. REFUSES over quota, and storage-service is never called — §2.1 test 1', async () => {
      // The gate must SHORT-CIRCUIT rather than merely also-reject downstream:
      // a tenant over quota must never receive a usable URL, or they discover
      // the refusal only after uploading 25 MB.
      getStorageLimitBytes.mockResolvedValue(1024);
      await createDocument(fx.prisma, tenant, { fileSizeBytes: BigInt(1024) });

      await expectRpc(
        documents.presignDocument(presignRequest(), manager()),
        status.RESOURCE_EXHAUSTED,
      );

      expect(presignDocument).not.toHaveBeenCalled();
    });

    it('3. counts only LIVE documents toward the quota', async () => {
      // A soft-deleted document still occupies bytes in the bucket until the
      // supersede event lands, but counting it here would leave a tenant unable
      // to replace a document they just removed — the exact operation they are
      // most likely to be doing.
      getStorageLimitBytes.mockResolvedValue(4096);
      await createDocument(fx.prisma, tenant, {
        fileSizeBytes: BigInt(4000),
        deletedAt: new Date(),
        deletedById: tenant.userId,
      });

      await expect(
        documents.presignDocument(presignRequest(), manager()),
      ).resolves.toBeDefined();
    });

    it('4. REFUSES a type outside the allowlist before any quota read', async () => {
      await expectRpc(
        documents.presignDocument(
          presignRequest({ contentType: 'application/x-httpd-php' }),
          manager(),
        ),
        status.INVALID_ARGUMENT,
      );

      expect(getStorageLimitBytes).not.toHaveBeenCalled();
      expect(presignDocument).not.toHaveBeenCalled();
    });

    it('5. REFUSES a file over the per-file cap', async () => {
      await expectRpc(
        documents.presignDocument(
          presignRequest({ sizeBytes: 26 * 1024 * 1024 }),
          manager(),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('6. creates NO documents row — §2.1 test 3', async () => {
      // An abandoned presign must leave nothing pointing at an object that
      // never arrived.
      await documents.presignDocument(presignRequest(), manager());

      expect(await fx.prisma.document.count()).toBe(0);
    });
  });

  describe('confirm', () => {
    it('1. creates the row PENDING and enqueues one job — §2.1 test 2', async () => {
      const document = await documents.confirmDocument(
        confirmRequest(),
        manager(),
      );

      expect(document.status).toBe(DocumentStatus.PENDING);
      expect(document.chunkCount).toBe(0);

      const jobs = await fx.prisma.ingestionJob.findMany({
        where: { documentId: document.id },
      });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].status).toBe(IngestionJobStatus.QUEUED);
    });

    it('2. publishes document.uploaded with the path the worker needs', async () => {
      const request = confirmRequest();

      const document = await documents.confirmDocument(request, manager());

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: DOCUMENT_PATTERNS.uploaded,
          organizationId: tenant.organizationId,
          documentId: document.id,
          objectPath: request.objectPath,
          fileType: 'pdf',
        }),
      );
    });

    it('3. stores the REAL size and type from the object metadata', async () => {
      // Not what the client declared at presign — those were a hint for the
      // policy check, and a row built from them records whatever the client
      // felt like claiming.
      confirmUpload.mockResolvedValue({
        sizeBytes: 9999,
        contentType: 'text/markdown',
      });

      const document = await documents.confirmDocument(
        confirmRequest(),
        manager(),
      );

      expect(document.fileSizeBytes).toBe(9999);
      expect(document.fileType).toBe('md');
    });

    it('4. writes the job in the SAME transaction as the document', async () => {
      // Outside it, a crash between the two leaves a PENDING document with
      // nothing scheduled to process it and nothing recording that fact.
      //
      // The failure is injected through `$transaction` rather than by spying on
      // `prisma.ingestionJob.create`: inside a transaction the service holds a
      // DIFFERENT client (`tx`), so a spy on the top-level one is never
      // consulted and the test would pass without proving anything. Wrapping
      // the callback lets the real work run and then fails the transaction,
      // which is what actually exercises the rollback.
      const real = fx.prisma.$transaction.bind(fx.prisma);
      faults.replace(fx.prisma, '$transaction', ((
        callback: (tx: unknown) => Promise<unknown>,
      ) =>
        real(async (tx: unknown) => {
          await callback(tx);
          throw new Error('injected failure');
        })) as never);

      await expect(
        documents.confirmDocument(confirmRequest(), manager()),
      ).rejects.toThrow('injected failure');

      // Neither survived — which is the point. A document with no job is a
      // document nothing will ever process.
      expect(await fx.prisma.document.count()).toBe(0);
      expect(await fx.prisma.ingestionJob.count()).toBe(0);
    });

    it('5. REFUSES org-wide AND departments together', async () => {
      // Two different intentions in one request. Picking either for the caller
      // leaves the document more or less visible than they believe.
      await expectRpc(
        documents.confirmDocument(
          confirmRequest({
            isOrganizationWide: true,
            departmentIds: [tenant.departmentId],
          }),
          manager(),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('6. VALIDATES department ids against auth-service before writing', async () => {
      assertDepartmentsExist.mockRejectedValue(
        new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'No department with that id in this workspace',
        }),
      );

      await expectRpc(
        documents.confirmDocument(
          confirmRequest({
            isOrganizationWide: false,
            departmentIds: [faker.string.uuid()],
          }),
          manager(),
        ),
        status.INVALID_ARGUMENT,
      );

      expect(await fx.prisma.document.count()).toBe(0);
      expect(confirmUpload).not.toHaveBeenCalled();
    });

    it('7. REJECTS a second confirm of the same object — §1.2 test 4', async () => {
      // Per-tenant dedup, and here the "duplicate" is a replayed confirm of one
      // upload. The partial unique index is what refuses it.
      const request = confirmRequest();
      await documents.confirmDocument(request, manager());

      await expectRpc(
        documents.confirmDocument(request, manager()),
        status.ALREADY_EXISTS,
      );

      expect(await fx.prisma.document.count()).toBe(1);
    });

    it('8. lets TWO TENANTS confirm byte-identical uploads — §1.2 test 3', async () => {
      // Dedup is per tenant. Global dedup would leak the existence of one
      // tenant's upload to another, which is the kind of leak nobody looks for.
      const other = buildTenant();
      const request = confirmRequest();

      await documents.confirmDocument(request, manager());
      await documents.confirmDocument(
        request,
        memberContext(
          { id: other.userId, organizationId: other.organizationId },
          ['document.create'],
        ),
      );

      expect(await fx.prisma.document.count()).toBe(2);
    });

    it('9. REFUSES an empty title', async () => {
      await expectRpc(
        documents.confirmDocument(confirmRequest({ title: '   ' }), manager()),
        status.INVALID_ARGUMENT,
      );
    });
  });

  // --------------------------------------------------------- §2.2 visibility

  describe('visibility — org-wide ∪ the caller’s departments', () => {
    it('1. an ORG-WIDE document is visible to every member — §2.2 test 1', async () => {
      const document = await createDocument(fx.prisma, tenant, {
        isOrganizationWide: true,
      });

      const { items } = await documents.listDocuments(
        listRequest(),
        outsider(),
      );

      expect(items.map((d) => d.id)).toEqual([document.id]);
    });

    it('2. a DEPARTMENT-SCOPED document is invisible outside it — §2.2 test 2', async () => {
      await createScopedDocument(fx.prisma, tenant, [tenant.departmentId]);

      const { items, meta } = await documents.listDocuments(
        listRequest(),
        outsider(),
      );

      expect(items).toEqual([]);
      // The COUNT too. A total that included documents the caller cannot fetch
      // would tell them how many exist that they are not allowed to see.
      expect(meta!.totalItems).toBe(0);
    });

    it('3. a user in ONE of several departments can see it — §2.2 test 3', async () => {
      // The SQL side of `MatchAny`'s intersection semantics: overlap, not
      // containment. Requiring the caller to be in every listed department
      // would make multi-department scoping useless.
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
        tenant.otherDepartmentId,
      ]);

      const { items } = await documents.listDocuments(listRequest(), manager());

      expect(items.map((d) => d.id)).toEqual([document.id]);
    });

    it('4. a by-id read applies the SAME predicate as the list', async () => {
      // A document invisible in the list but fetchable by id is the disclosure
      // this predicate exists to prevent, one route removed.
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);

      await expectRpc(
        documents.getDocument({ id: document.id }, outsider()),
        status.NOT_FOUND,
      );
      await expect(
        documents.getDocument({ id: document.id }, manager()),
      ).resolves.toBeDefined();
    });

    it('5. answers NOT_FOUND across TENANTS — §2.1 test 4', async () => {
      const document = await createDocument(fx.prisma, tenant);

      await expectRpc(
        documents.getDocument({ id: document.id }, manager(buildTenant())),
        status.NOT_FOUND,
      );
    });

    it('6. hides another tenant’s documents from the list', async () => {
      await createDocument(fx.prisma, tenant);
      const stranger = buildTenant();
      const mine = await createDocument(fx.prisma, stranger);

      const { items } = await documents.listDocuments(
        listRequest(),
        manager(stranger),
      );

      expect(items.map((d) => d.id)).toEqual([mine.id]);
    });

    it('7. filters by STATUS and by DEPARTMENT', async () => {
      await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
      });
      const pending = await createScopedDocument(
        fx.prisma,
        tenant,
        [tenant.departmentId],
        { status: DocumentStatus.PENDING },
      );

      const byStatus = await documents.listDocuments(
        listRequest({ status: DocumentStatus.PENDING }),
        manager(),
      );
      const byDepartment = await documents.listDocuments(
        listRequest({ departmentId: tenant.departmentId }),
        manager(),
      );

      expect(byStatus.items.map((d) => d.id)).toEqual([pending.id]);
      expect(byDepartment.items.map((d) => d.id)).toEqual([pending.id]);
    });
  });

  // ---------------------------------------------------------- §2.3 re-scoping

  describe('re-scoping', () => {
    it('1. replaces the department set and fans out to the CHUNK rows', async () => {
      // The chunk rows are the lexical retrieval arm's half of the boundary
      // (11-doc §1.4). A re-scope that updated `documents` alone would leave
      // that arm serving the document to people who just lost access.
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);
      await createChunks(fx.prisma, document, 3, [tenant.departmentId]);

      await documents.setDocumentDepartments(
        { id: document.id, departmentIds: [tenant.otherDepartmentId] },
        manager(),
      );

      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });
      expect(chunks).toHaveLength(3);
      for (const chunk of chunks) {
        expect(chunk.departmentIds).toEqual([tenant.otherDepartmentId]);
      }
    });

    it('2. is REFUSED while the document is organization-wide (409) — §2.3 test 4', async () => {
      // Refused rather than silently ignored: an admin scoping a document to
      // two departments believes they have restricted it, and a request that
      // "succeeded" while leaving it visible to everyone is the worst answer.
      const document = await createDocument(fx.prisma, tenant, {
        isOrganizationWide: true,
      });

      await expectRpc(
        documents.setDocumentDepartments(
          { id: document.id, departmentIds: [tenant.departmentId] },
          manager(),
        ),
        status.ABORTED,
      );
    });

    it('3. announces a RESTRICTION as restricting', async () => {
      // The flag is what decides the fan-out order downstream, and re-deriving
      // it from a diff in the consumer would be re-deriving a security property.
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
        tenant.otherDepartmentId,
      ]);

      await documents.setDocumentDepartments(
        { id: document.id, departmentIds: [tenant.departmentId] },
        manager(),
      );

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: DOCUMENT_PATTERNS.scopeChanged,
          documentId: document.id,
          restricting: true,
        }),
      );
    });

    it('4. announces a pure GRANT as not restricting', async () => {
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);

      await documents.setDocumentDepartments(
        {
          id: document.id,
          departmentIds: [tenant.departmentId, tenant.otherDepartmentId],
        },
        manager(),
      );

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: DOCUMENT_PATTERNS.scopeChanged,
          restricting: false,
        }),
      );
    });

    it('5. treats a MIXED change as a restriction', async () => {
      // Both adds and removes in one call. The half that matters for safety is
      // the half that takes access away, so the whole change is ordered as a
      // restriction.
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);

      await documents.setDocumentDepartments(
        { id: document.id, departmentIds: [tenant.otherDepartmentId] },
        manager(),
      );

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ restricting: true }),
      );
    });

    it('6. turning org-wide OFF is a restriction', async () => {
      const document = await createDocument(fx.prisma, tenant, {
        isOrganizationWide: true,
      });

      await documents.updateDocument(
        { id: document.id, title: undefined, isOrganizationWide: false },
        manager(),
      );

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ restricting: true }),
      );
    });
  });

  // ------------------------------------------------------- §2.4 soft delete

  describe('soft delete', () => {
    it('1. flips is_deleted on the CHUNKS, never removing them — §2.4 test 2', async () => {
      // Citations in already-sent ticket messages must still resolve to their
      // chunk text (RDM §1.4, §1.6). Flipping takes them out of retrieval
      // without taking them out of history.
      const document = await createDocument(fx.prisma, tenant);
      await createChunks(fx.prisma, document, 3);

      await documents.deleteDocument({ id: document.id }, manager());

      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });
      expect(chunks).toHaveLength(3);
      expect(chunks.every((chunk) => chunk.isDeleted)).toBe(true);
      expect(chunks.every((chunk) => chunk.contentText.length > 0)).toBe(true);
    });

    it('2. writes QDRANT before the chunk rows, and both before `documents`', async () => {
      // The full restriction order, pinned by observation rather than by
      // reading the code. Both stores are retrievable, so both must be
      // narrowed before the response — an earlier version left Qdrant to the
      // async reconciler, and for as long as that job sat in the queue the
      // semantic arm kept serving a document the API had already reported
      // deleted.
      const document = await createDocument(fx.prisma, tenant);
      await createChunks(fx.prisma, document, 2);

      const order: string[] = [];
      faults.replace(qdrant, 'setDocumentScope', () => {
        order.push('qdrant');
        return Promise.resolve();
      });
      faults.replace(fx.prisma.documentChunk, 'updateMany', (() => {
        order.push('chunks');
        return Promise.resolve({ count: 2 });
      }) as never);

      await documents.deleteDocument({ id: document.id }, manager());

      expect(order).toEqual(['qdrant', 'chunks']);
    });

    it('2b. Leaves the document LISTED but unretrievable when `documents` fails', async () => {
      // Failing after both retrievable stores are narrowed leaves the document
      // over-restricted — invisible in retrieval while still listed — which is
      // safe, visible and fixable by retry. The reverse order leaves a document
      // every screen says is deleted and the RAG pipeline keeps serving.
      const document = await createDocument(fx.prisma, tenant);
      await createChunks(fx.prisma, document, 2);
      faults.failOnce(
        fx.prisma.document,
        'update',
        new Error('injected failure'),
      );

      await expect(
        documents.deleteDocument({ id: document.id }, manager()),
      ).rejects.toThrow('injected failure');

      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });
      const row = await fx.prisma.document.findUniqueOrThrow({
        where: { id: document.id },
      });

      // Over-restricted: chunks out of retrieval, document still listed.
      expect(chunks.every((chunk) => chunk.isDeleted)).toBe(true);
      expect(row.deletedAt).toBeNull();
    });

    it('3. removes it from the ordinary list and by-id read', async () => {
      const document = await createDocument(fx.prisma, tenant);
      await documents.deleteDocument({ id: document.id }, manager());

      const { items } = await documents.listDocuments(listRequest(), manager());
      expect(items).toEqual([]);
      await expectRpc(
        documents.getDocument({ id: document.id }, manager()),
        status.NOT_FOUND,
      );
    });

    it('4. records WHO deleted it', async () => {
      const document = await createDocument(fx.prisma, tenant);

      await documents.deleteDocument({ id: document.id }, manager());

      const row = await fx.prisma.document.findUniqueOrThrow({
        where: { id: document.id },
      });
      expect(row.deletedById).toBe(tenant.userId);
      expect(row.deletedAt).not.toBeNull();
    });

    it('5. restore un-flips the chunks and clears both delete columns', async () => {
      const document = await createDocument(fx.prisma, tenant);
      await createChunks(fx.prisma, document, 2);
      await documents.deleteDocument({ id: document.id }, manager());

      await documents.restoreDocument({ id: document.id }, manager());

      const row = await fx.prisma.document.findUniqueOrThrow({
        where: { id: document.id },
      });
      const chunks = await fx.prisma.documentChunk.findMany({
        where: { documentId: document.id },
      });
      expect(row.deletedAt).toBeNull();
      expect(row.deletedById).toBeNull();
      expect(chunks.every((chunk) => !chunk.isDeleted)).toBe(true);
    });

    it('6. restoring into a TAKEN hash slot is 409, not 500 — §2.4 test 3', async () => {
      // The partial unique index released the slot when the document was
      // soft-deleted, and somebody re-uploaded the same file since. The P2002
      // must be caught and NAMED — a raw 500 tells an admin nothing about why
      // their restore failed. Identical to Domain A's user-restore case.
      const document = await createDocument(fx.prisma, tenant, {
        fileHash: 'a'.repeat(64),
      });
      await documents.deleteDocument({ id: document.id }, manager());
      await createDocument(fx.prisma, tenant, { fileHash: 'a'.repeat(64) });

      await expectRpc(
        documents.restoreDocument({ id: document.id }, manager()),
        status.ALREADY_EXISTS,
      );
    });

    it('7. restore 404s for a document that is not deleted', async () => {
      const document = await createDocument(fx.prisma, tenant);

      await expectRpc(
        documents.restoreDocument({ id: document.id }, manager()),
        status.NOT_FOUND,
      );
    });

    it('8. surfaces deleted documents only with includeDeleted', async () => {
      const document = await createDocument(fx.prisma, tenant);
      await documents.deleteDocument({ id: document.id }, manager());

      const { items } = await documents.listDocuments(
        listRequest({ includeDeleted: true }),
        manager(),
      );

      expect(items.map((d) => d.id)).toEqual([document.id]);
    });
  });

  // ------------------------------------------------------------- read surface

  describe('download and chunks', () => {
    it('1. re-checks visibility BEFORE the storage call', async () => {
      // storage-service refuses paths from another TENANT, which is coarser
      // than the boundary that matters here — it knows nothing about this
      // document's department scoping and never will.
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);

      await expectRpc(
        documents.downloadDocument({ id: document.id }, outsider()),
        status.NOT_FOUND,
      );

      expect(resolveReadUrls).not.toHaveBeenCalled();
    });

    it('2. returns a signed URL for a caller who may see it', async () => {
      const document = await createDocument(fx.prisma, tenant);

      const result = await documents.downloadDocument(
        { id: document.id },
        manager(),
      );

      expect(result.downloadUrl).toContain('https://signed/');
      expect(result.expiresAt).toBeDefined();
    });

    it('3. 404s when the OBJECT is gone but the row is not', async () => {
      resolveReadUrls.mockResolvedValue({});
      const document = await createDocument(fx.prisma, tenant);

      await expectRpc(
        documents.downloadDocument({ id: document.id }, manager()),
        status.NOT_FOUND,
      );
    });

    it('4. lists chunks in index order', async () => {
      const document = await createDocument(fx.prisma, tenant);
      await createChunks(fx.prisma, document, 5);

      const { items } = await documents.listDocumentChunks(
        { documentId: document.id, page: pageRequest() },
        manager(),
      );

      expect(items.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2, 3, 4]);
    });

    it('5. reports a chunk with NO vectorPointId as not yet retrievable', async () => {
      // The absence is meaningful — the Qdrant upsert has not written back yet
      // — so it is reported rather than defaulted to something.
      const document = await createDocument(fx.prisma, tenant);
      await createChunks(fx.prisma, document, 1);

      const { items } = await documents.listDocumentChunks(
        { documentId: document.id, page: pageRequest() },
        manager(),
      );

      expect(items[0].vectorPointId).toBeUndefined();
    });

    it('6. scopes chunk reads through the DOCUMENT', async () => {
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);
      await createChunks(fx.prisma, document, 1);

      await expectRpc(
        documents.listDocumentChunks(
          { documentId: document.id, page: pageRequest() },
          outsider(),
        ),
        status.NOT_FOUND,
      );
    });

    it('7. reports workspace storage usage against the entitlement', async () => {
      await createDocument(fx.prisma, tenant, { fileSizeBytes: BigInt(1000) });
      await createDocument(fx.prisma, tenant, { fileSizeBytes: BigInt(2000) });

      const usage = await documents.getStorageUsage(manager());

      expect(usage.usedBytes).toBe(3000);
      expect(usage.limitBytes).toBe(DEFAULT_STORAGE_LIMIT);
      expect(usage.documentCount).toBe(2);
    });
  });

  // ------------------------------------------------- §16 §5 — the flag list

  describe('listDocumentFlags', () => {
    /**
     * The filter must express `UNRETRIEVED` and `UNCITED` SEPARATELY.
     *
     * They were one flag under a name that fitted only the first, and were
     * split because they are different findings with different fixes: a
     * document nobody's question came near may just be mis-titled, while one
     * retrieved twenty times and cited never is displacing the sources that
     * would have answered. A filter offering only `UNCITED` re-merges them in
     * practice — the type nobody can select is the type nobody sees.
     */
    async function seedFlags() {
      const unretrieved = await createDocument(fx.prisma, tenant, {
        title: 'Never found',
      });
      const uncited = await createDocument(fx.prisma, tenant, {
        title: 'Found and ignored',
      });

      await createFlag(fx.prisma, unretrieved, {
        flagType: DocumentFlagType.UNRETRIEVED,
      });
      await createFlag(fx.prisma, uncited, {
        flagType: DocumentFlagType.UNCITED,
        severity: DocumentFlagSeverity.WARNING,
      });

      return { unretrieved, uncited };
    }

    const flagsRequest = (
      overrides: Partial<{
        flagTypes: string[];
        includeResolved: boolean;
      }> = {},
    ) => ({
      flagTypes: [],
      includeResolved: false,
      page: pageRequest({ sortBy: 'detectedAt' }),
      ...overrides,
    });

    it('1. returns EVERY type when no filter is given', async () => {
      await seedFlags();

      const { items } = await documents.listDocumentFlags(
        flagsRequest(),
        manager(),
      );

      expect(items.map((flag) => flag.flagType).sort()).toEqual([
        DocumentFlagType.UNCITED,
        DocumentFlagType.UNRETRIEVED,
      ]);
    });

    it('2. filters to UNRETRIEVED alone', async () => {
      await seedFlags();

      const { items } = await documents.listDocumentFlags(
        flagsRequest({ flagTypes: [DocumentFlagType.UNRETRIEVED] }),
        manager(),
      );

      expect(items).toHaveLength(1);
      expect(items[0].documentTitle).toBe('Never found');
    });

    it('3. filters to UNCITED alone', async () => {
      await seedFlags();

      const { items } = await documents.listDocumentFlags(
        flagsRequest({ flagTypes: [DocumentFlagType.UNCITED] }),
        manager(),
      );

      expect(items).toHaveLength(1);
      expect(items[0].documentTitle).toBe('Found and ignored');
    });

    it('4. accepts BOTH at once', async () => {
      await seedFlags();

      const { items } = await documents.listDocumentFlags(
        flagsRequest({
          flagTypes: [DocumentFlagType.UNRETRIEVED, DocumentFlagType.UNCITED],
        }),
        manager(),
      );

      expect(items).toHaveLength(2);
    });

    it('5. REFUSES an unknown type rather than ignoring it', async () => {
      // Silently dropping the filter answers a different question than the one
      // asked, and "no OUTDTAED flags" reads as "nothing is outdated".
      await expectRpc(
        documents.listDocumentFlags(
          flagsRequest({ flagTypes: ['OUTDTAED'] }),
          manager(),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('6. hides RESOLVED flags unless asked', async () => {
      // A resolved flag is history. Mixing history into a worklist is how a
      // worklist stops being read.
      const document = await createDocument(fx.prisma, tenant);
      await createFlag(fx.prisma, document, { resolvedAt: new Date() });

      const hidden = await documents.listDocumentFlags(
        flagsRequest(),
        manager(),
      );
      expect(hidden.items).toHaveLength(0);

      const shown = await documents.listDocumentFlags(
        flagsRequest({ includeResolved: true }),
        manager(),
      );
      expect(shown.items).toHaveLength(1);
    });

    it('7. carries the document TITLE, so the list is readable', async () => {
      const document = await createDocument(fx.prisma, tenant, {
        title: 'Expense policy 2019',
      });
      await createFlag(fx.prisma, document);

      const { items } = await documents.listDocumentFlags(
        flagsRequest(),
        manager(),
      );

      expect(items[0].documentTitle).toBe('Expense policy 2019');
    });

    it('8. shows NOTHING from another tenant', async () => {
      const other = buildTenant();
      const document = await createDocument(fx.prisma, other);
      await createFlag(fx.prisma, document);

      const { items } = await documents.listDocumentFlags(
        flagsRequest(),
        manager(),
      );

      expect(items).toHaveLength(0);
    });

    it('9. drops a DELETED document’s flags from the worklist', async () => {
      // Otherwise the list keeps asking a reviewer to act on a document that no
      // longer exists, and the join would still surface its title.
      const document = await createDocument(fx.prisma, tenant);
      await createFlag(fx.prisma, document);
      await documents.deleteDocument({ id: document.id }, manager());

      const { items } = await documents.listDocumentFlags(
        flagsRequest(),
        manager(),
      );

      expect(items).toHaveLength(0);
    });
  });

  /**
   * The batch contract — 27-doc §1, §3.
   *
   * The property specific to THIS service is the department boundary: a
   * document scoped to a department is invisible outside it (11-doc §1.4), and
   * a batch read that skipped `visibilityScope` would be a way to fetch any
   * document in the tenant one id at a time — including its TITLE, which is
   * usually the sensitive part.
   */
  describe('§1 ListDocumentsByIds / ListDocumentChunksByIds', () => {
    it('1. **the department boundary applies to a batch read**', async () => {
      const scoped = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);

      const { items } = await documents.listDocumentsByIds(
        { documentIds: [scoped.id] },
        outsider(),
      );

      expect(items).toEqual([]);
    });

    it('2. and an insider does get it', async () => {
      // The other half — otherwise test 1 passes against an RPC that returns
      // nothing to anyone.
      const scoped = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);

      const { items } = await documents.listDocumentsByIds(
        { documentIds: [scoped.id] },
        manager(),
      );

      expect(items.map((item) => item.id)).toEqual([scoped.id]);
    });

    it('3. unknown ids are omitted; an empty request is empty', async () => {
      const document = await createDocument(fx.prisma, tenant, {
        isOrganizationWide: true,
      });

      const found = await documents.listDocumentsByIds(
        { documentIds: [document.id, randomUUID()] },
        manager(),
      );
      const empty = await documents.listDocumentsByIds(
        { documentIds: [] },
        manager(),
      );

      expect(found.items.map((item) => item.id)).toEqual([document.id]);
      expect(empty.items).toEqual([]);
    });

    it('4. an over-cap document batch is INVALID_ARGUMENT', async () => {
      await expectRpc(
        documents.listDocumentsByIds(
          {
            documentIds: Array.from({ length: BATCH_ID_LIMIT + 1 }, () =>
              randomUUID(),
            ),
          },
          manager(),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('5. **chunks are capped HARDER than everything else**', async () => {
      // 27-doc §3. A chunk carries its whole text, so these are the largest
      // payloads in the system: 50 of them is megabytes where 200 users is
      // kilobytes. The cap is about BYTES, and one number shared with the other
      // batches would be wrong for one of them.
      expect(BATCH_CHUNK_LIMIT).toBeLessThan(BATCH_ID_LIMIT);

      await expectRpc(
        documents.listDocumentChunksByIds(
          {
            chunkIds: Array.from({ length: BATCH_CHUNK_LIMIT + 1 }, () =>
              randomUUID(),
            ),
          },
          manager(),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it("6. **a chunk inherits its document's boundary**", async () => {
      // Scoped through the parent rather than on the chunk row: the department
      // boundary lives on the document, and filtering on the chunk alone would
      // return TEXT from a document the caller cannot open — a worse leak than
      // the title.
      const scoped = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);
      // Created directly: the document fixture stops at the row, and a test
      // that looked for a chunk the fixture never makes would find none and
      // pass while asserting nothing about the boundary.
      const chunk = await fx.prisma.documentChunk.create({
        data: {
          documentId: scoped.id,
          // Denormalised onto the chunk for retrieval, and deliberately NOT
          // what this RPC scopes on — the department boundary lives on the
          // document, so filtering here would return text from a document the
          // caller cannot open.
          organizationId: tenant.organizationId,
          chunkIndex: 0,
          contentText: 'The redundancy list is attached.',
          tokenCount: 8,
        },
        select: { id: true },
      });

      const outside = await documents.listDocumentChunksByIds(
        { chunkIds: [chunk.id] },
        outsider(),
      );
      const inside = await documents.listDocumentChunksByIds(
        { chunkIds: [chunk.id] },
        manager(),
      );

      expect(outside.items).toEqual([]);
      expect(inside.items.map((item) => item.chunkId)).toEqual([chunk.id]);
    });
  });
});
