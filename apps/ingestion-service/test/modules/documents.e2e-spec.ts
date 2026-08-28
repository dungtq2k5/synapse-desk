import { RpcException } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import {
  BATCH_CHUNK_LIMIT,
  BATCH_ID_LIMIT,
  DOCUMENT_PATTERNS,
  DocumentFlagResolution,
  DocumentStatus,
  IngestionJobStatus,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_TENANT,
  SupersededReason,
  type DocumentFileType,
} from '@synapsedesk/common';
import {
  type ListDocumentsRequest,
  fromProtoDocumentFileType,
  fromProtoDocumentStatus,
  toProtoDocumentFileType,
  toProtoDocumentStatus,
  toProtoIngestionJobStatus,
} from '@synapsedesk/grpc-proto';
import { expectRpc, rpcCode } from '@synapsedesk/common/testing/rpc';
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
  createIngestionJob,
  createScopedDocument,
  TenantFixture,
} from '../factories';
import { DocumentsService } from '../../src/modules/documents/documents.service';
import { QdrantService } from '../../src/modules/qdrant/qdrant.service';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { StorageReferenceService } from '../../src/modules/storage-client/storage-reference.service';
import { DocumentEventPublisher } from '../../src/modules/events/document-event.publisher';
import { faultInjector } from '@synapsedesk/common/testing/fault';

describe('Documents (e2e)', () => {
  // Every injected fault in this file is registered here and restored in an
  // `afterEach` that runs whether the test passed, failed or threw.
  const faults = faultInjector();

  let fx: E2eFixture;
  let documents: DocumentsService;
  let qdrant: QdrantService;
  let authReference: AuthReferenceService;
  let storage: StorageReferenceService;
  let events: DocumentEventPublisher;

  let getStorageLimitBytes: jest.SpyInstance;
  let getDocumentSizeLimitBytes: jest.SpyInstance;
  let getDocumentCountLimit: jest.SpyInstance;
  let assertDepartmentsExist: jest.SpyInstance;
  let presignDocument: jest.SpyInstance;
  let confirmUpload: jest.SpyInstance;
  let emitSuperseded: jest.SpyInstance;
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
    ocrLanguages: [],
    ...overrides,
  });

  const confirmRequest = (overrides: Record<string, unknown> = {}) => ({
    objectPath: `organizations/${tenant.organizationId}/documents/${faker.string.uuid()}/x.pdf`,
    title: '2026 Employee Handbook',
    isOrganizationWide: true,
    departmentIds: [] as string[],
    fileName: 'handbook.pdf',
    ocrLanguages: [],
    ...overrides,
  });

  /**
   * Takes DOMAIN values and converts, so call sites still read
   * `{ status: DocumentStatus.INDEXED }` rather than a proto member name.
   *
   * The two enumerated filters default to UNSPECIFIED, which is what the empty
   * strings here used to stand in for — proto3's zero value already means
   * "no filter".
   */
  const listRequest = (
    overrides: Partial<{
      status: DocumentStatus;
      departmentId: string;
      fileType: DocumentFileType;
      includeDeleted: boolean;
      page: ReturnType<typeof pageRequest>;
    }> = {},
  ): ListDocumentsRequest => ({
    page: overrides.page ?? pageRequest(),
    status: toProtoDocumentStatus(overrides.status),
    departmentId: overrides.departmentId ?? '',
    fileType: toProtoDocumentFileType(overrides.fileType),
    includeDeleted: overrides.includeDeleted ?? false,
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
    getDocumentSizeLimitBytes = jest.spyOn(
      authReference,
      'getDocumentSizeLimitBytes',
    );
    getDocumentCountLimit = jest.spyOn(authReference, 'getDocumentCountLimit');
    assertDepartmentsExist = jest.spyOn(
      authReference,
      'assertDepartmentsExist',
    );
    presignDocument = jest.spyOn(storage, 'presignDocument');
    confirmUpload = jest.spyOn(storage, 'confirmUpload');
    resolveReadUrls = jest.spyOn(storage, 'resolveReadUrls');
    // Fire-and-forget into NATS, which is not running here — and the ARGUMENT
    // is the assertion, so it must be observed rather than merely silenced.
    emitSuperseded = jest
      .spyOn(storage, 'emitSuperseded')
      .mockImplementation(() => {});
    publish = jest.spyOn(events, 'publish').mockImplementation(() => {});
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();

    // Re-stated every test: `clearAllMocks` resets call records but keeps
    // implementations, so one test's override would leak into every later one.
    getStorageLimitBytes.mockResolvedValue(DEFAULT_STORAGE_LIMIT);
    // Nothing configured is the normal state, so the platform ceiling applies.
    getDocumentSizeLimitBytes.mockResolvedValue(MAX_DOCUMENT_BYTES);
    getDocumentCountLimit.mockResolvedValue(MAX_DOCUMENTS_PER_TENANT);
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

  // ------------------------------------------------------------- upload

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

    it('**1b. a TENANT-NARROWED size limit is enforced, and names the workspace**', async () => {
      // `min(platform, tenant)` — the platform constant still bounds it, and
      // the tenant's own number is the one that bites here.
      //
      // **The message says "this workspace"**, not the platform figure. An
      // uploader told their 3 MB file exceeds a 100 MB limit goes looking for a
      // bug; told their workspace does not accept files that large, they ask
      // their admin.
      getDocumentSizeLimitBytes.mockResolvedValue(2_000_000);

      await expectRpc(
        documents.presignDocument(
          { ...presignRequest(), sizeBytes: 3_000_000 },
          manager(),
        ),
        status.INVALID_ARGUMENT,
      );

      // Never signed. A tenant that narrowed its limit must not receive a URL
      // that would have worked.
      expect(presignDocument).not.toHaveBeenCalled();
    });

    it('**1c. …and a file UNDER the tenant limit still goes through**', async () => {
      // The pair. Test 1b alone passes for an implementation that refuses every
      // upload once an override exists.
      getDocumentSizeLimitBytes.mockResolvedValue(2_000_000);

      const result = await documents.presignDocument(
        { ...presignRequest(), sizeBytes: 1_000_000 },
        manager(),
      );

      expect(result.uploadUrl).toBeTruthy();
    });

    it('**1d. an UNREADABLE limit refuses the upload — it never means "unlimited"**', async () => {
      // Fails closed, matching the storage quota beside it. Resolving to the
      // platform ceiling is the tempting middle ground and is still wrong: it
      // hands a tenant that narrowed its limit the wide one at exactly the
      // moment the check could not run.
      getDocumentSizeLimitBytes.mockRejectedValue(
        new RpcException({
          code: status.UNAVAILABLE,
          message: 'Could not verify the document size limit',
        }),
      );

      await expectRpc(
        documents.presignDocument(presignRequest(), manager()),
        status.UNAVAILABLE,
      );
      expect(presignDocument).not.toHaveBeenCalled();
    });

    it('2. REFUSES over quota, and storage-service is never called', async () => {
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

    it('**2b. REFUSES at the document COUNT limit, and keeps every document**', async () => {
      // The admission rule for the newest dimension, and both halves in one
      // test because
      // either alone passes for a broken system: a limit that refuses nothing,
      // or a sweep that trims the tenant down to fit. The count gates
      // ADMISSION, so lowering it can only refuse the NEXT upload.
      getDocumentCountLimit.mockResolvedValue(2);
      await createDocument(fx.prisma, tenant);
      await createDocument(fx.prisma, tenant);

      await expectRpc(
        documents.presignDocument(presignRequest(), manager()),
        status.RESOURCE_EXHAUSTED,
      );

      // Nothing was taken away to make room.
      await expect(
        fx.prisma.document.count({
          where: { organizationId: tenant.organizationId, deletedAt: null },
        }),
      ).resolves.toBe(2);
      expect(presignDocument).not.toHaveBeenCalled();
    });

    it('2c. …and the upload that fits EXACTLY is admitted', async () => {
      // The boundary, in the direction that matters: at one below the limit the
      // next upload is the one that fills it, not the one that is refused. A
      // `>=` here would cost every tenant their last slot silently.
      getDocumentCountLimit.mockResolvedValue(2);
      await createDocument(fx.prisma, tenant);

      await expect(
        documents.presignDocument(presignRequest(), manager()),
      ).resolves.toMatchObject({ uploadUrl: expect.any(String) });
    });

    it('2d. **A ZERO limit refuses cleanly — the lost-wire case is not a 500**', async () => {
      // `getDocumentCountLimit` resolves `min(platform, grant ?? 0)`, so a wire
      // that lost the grant yields ZERO. That is the fail-closed direction and
      // it must arrive as a refusal the caller can read, not as an internal
      // error — which is exactly what `countLimit - 1` would produce, since
      // `exceedsLimit` rejects a negative ceiling as unusable.
      getDocumentCountLimit.mockResolvedValue(0);

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
          // DERIVED, not a second magic number. This read `26 * 1024 * 1024`
          // against a 25MB cap, so raising the cap to 100MB left the test
          // asserting a refusal for a size now comfortably UNDER it — passing
          // the request and failing the assertion.
          presignRequest({ sizeBytes: MAX_DOCUMENT_BYTES + 1 }),
          manager(),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('6. creates NO documents row', async () => {
      // An abandoned presign must leave nothing pointing at an object that
      // never arrived.
      await documents.presignDocument(presignRequest(), manager());

      expect(await fx.prisma.document.count()).toBe(0);
    });
  });

  describe('confirm', () => {
    it('1. creates the row PENDING and enqueues one job', async () => {
      const document = await documents.confirmDocument(
        confirmRequest(),
        manager(),
      );

      // Through the bridge: the RESPONSE carries the proto enum's integer,
      // while the NATS event two tests below carries the domain string. Both
      // are correct and they are not the same value — asserting the domain name
      // against the wire is what this test caught.
      expect(fromProtoDocumentStatus(document.status)).toBe(
        DocumentStatus.PENDING,
      );
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
      expect(fromProtoDocumentFileType(document.fileType)).toBe('md');
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

    it('7. REJECTS a second confirm of the same object', async () => {
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

    it('8. lets TWO TENANTS confirm byte-identical uploads', async () => {
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

  describe('the ocrLanguages bound', () => {
    it('**1. confirm REFUSES an unsupported code rather than storing it**', async () => {
      // Bounded here as well as at the gateway DTO, for the reason
      // `MAX_BULK_TICKET_IDS` gives: this service is reachable from other
      // services over gRPC, where no `ValidationPipe` ever ran. The column
      // carried a comment saying validation happened at the gateway, which is a
      // description of one caller rather than a check.
      await expectRpc(
        documents.confirmDocument(
          confirmRequest({ ocrLanguages: ['kl'] }),
          manager(),
        ),
        status.INVALID_ARGUMENT,
      );

      expect(await fx.prisma.document.count()).toBe(0);
    });

    it('2. and names the offending code, so the caller can act on it', async () => {
      const refused = documents.confirmDocument(
        confirmRequest({ ocrLanguages: ['en', 'kl'] }),
        manager(),
      );

      await expect(refused).rejects.toMatchObject({
        message: expect.stringContaining('kl') as string,
      });
    });

    it('**3. replace refuses it too — the same column, the same way in**', async () => {
      const document = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
      });

      await expectRpc(
        documents.replaceDocument(
          {
            id: document.id,
            objectPath: `organizations/${tenant.organizationId}/documents/${document.id}/new.pdf`,
            ocrLanguages: ['kl'],
          },
          manager(),
        ),
        status.INVALID_ARGUMENT,
      );

      const reloaded = await fx.prisma.document.findUniqueOrThrow({
        where: { id: document.id },
      });
      expect(reloaded.fileUrl).toBe(document.fileUrl);
    });

    it('4. a supported code still stores, so the check is not refusing everything', async () => {
      // Otherwise 1-3 pass against a bound that rejects unconditionally.
      const result = await documents.confirmDocument(
        confirmRequest({ ocrLanguages: ['vi', 'en'] }),
        manager(),
      );

      const stored = await fx.prisma.document.findUniqueOrThrow({
        where: { id: result.id },
      });
      expect(stored.ocrLanguages).toEqual(['vi', 'en']);
    });
  });

  // --------------------------------------------------------- visibility

  describe('visibility — org-wide ∪ the caller’s departments', () => {
    it('1. an ORG-WIDE document is visible to every member', async () => {
      const document = await createDocument(fx.prisma, tenant, {
        isOrganizationWide: true,
      });

      const { items } = await documents.listDocuments(
        listRequest(),
        outsider(),
      );

      expect(items.map((d) => d.id)).toEqual([document.id]);
    });

    it('2. a DEPARTMENT-SCOPED document is invisible outside it', async () => {
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

    it('3. a user in ONE of several departments can see it', async () => {
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

    it('5. answers NOT_FOUND across TENANTS', async () => {
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

  // ---------------------------------------------------------- re-scoping

  describe('re-scoping', () => {
    it('1. replaces the department set and fans out to the CHUNK rows', async () => {
      // The chunk rows are the lexical retrieval arm's half of the boundary.
      // A re-scope that updated `documents` alone would leave
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

    it('2. is REFUSED while the document is organization-wide (409)', async () => {
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

  // ------------------------------------------------------- soft delete

  describe('soft delete', () => {
    it('1. flips is_deleted on the CHUNKS, never removing them', async () => {
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

    it('6. restoring into a TAKEN hash slot is 409, not 500', async () => {
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

  // --------------------------------------------------------- lifecycle

  describe('reindex', () => {
    const indexed = () =>
      createDocument(fx.prisma, tenant, { status: DocumentStatus.INDEXED });

    it('1. queues a NEW job and puts the document back to PENDING', async () => {
      const document = await indexed();
      const first = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.COMPLETED,
      });

      const job = await documents.reindexDocument(
        { id: document.id },
        manager(),
      );

      expect(job.id).not.toBe(first.id);
      expect(job.status).toBe(
        toProtoIngestionJobStatus(IngestionJobStatus.QUEUED),
      );
      const reloaded = await fx.prisma.document.findUniqueOrThrow({
        where: { id: document.id },
      });
      expect(reloaded.status).toBe(DocumentStatus.PENDING);
      // The file is untouched — that is the whole difference from replace.
      expect(reloaded.fileUrl).toBe(document.fileUrl);
    });

    it('2. supersedes the job it replaces, so the history reads in one direction', async () => {
      const document = await indexed();
      const first = await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.COMPLETED,
      });

      const job = await documents.reindexDocument(
        { id: document.id },
        manager(),
      );

      const source = await fx.prisma.ingestionJob.findUniqueOrThrow({
        where: { id: first.id },
      });
      expect(source.supersededById).toBe(job.id);
      // And its own status is left alone: COMPLETED is what happened.
      expect(source.status).toBe(IngestionJobStatus.COMPLETED);
    });

    it('3. **refuses a document that is not INDEXED, and names retry**', async () => {
      const failed = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.FAILED,
      });

      const refused = documents.reindexDocument({ id: failed.id }, manager());

      await expectRpc(refused, status.FAILED_PRECONDITION);
      await expect(refused).rejects.toMatchObject({
        message: expect.stringContaining('retry') as string,
      });
      expect(await fx.prisma.ingestionJob.count()).toBe(0);
    });

    it('4. refuses one still PROCESSING', async () => {
      const running = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.PROCESSING,
      });

      await expectRpc(
        documents.reindexDocument({ id: running.id }, manager()),
        status.FAILED_PRECONDITION,
      );
    });

    it('5. **two CONCURRENT reindexes produce one job**', async () => {
      // Neither the precondition nor the supersede claim can close this: both
      // are per-row, and this is two new rows for one document.
      const document = await indexed();
      await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.COMPLETED,
      });

      const outcomes = await Promise.allSettled([
        documents.reindexDocument({ id: document.id }, manager()),
        documents.reindexDocument({ id: document.id }, manager()),
      ]);

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      const lost = outcomes.filter(
        (o): o is PromiseRejectedResult => o.status === 'rejected',
      );
      expect(lost).toHaveLength(1);
      expect(rpcCode(lost[0].reason)).toBe(status.FAILED_PRECONDITION);
      // Two rows: the completed source and one successor.
      expect(await fx.prisma.ingestionJob.count()).toBe(2);
    });

    it('6. **leaves open flags alone — the file has not changed**', async () => {
      const document = await indexed();
      await createIngestionJob(fx.prisma, tenant, document.id, {
        status: IngestionJobStatus.COMPLETED,
      });
      const flag = await createFlag(fx.prisma, document);

      await documents.reindexDocument({ id: document.id }, manager());

      const reloaded = await fx.prisma.documentFlag.findUniqueOrThrow({
        where: { id: flag.id },
      });
      expect(reloaded.resolvedAt).toBeNull();
      expect(reloaded.resolution).toBeNull();
    });

    it('7. is NOT_FOUND for a soft-deleted document', async () => {
      const deleted = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
        deletedAt: new Date(),
      });

      await expectRpc(
        documents.reindexDocument({ id: deleted.id }, manager()),
        status.NOT_FOUND,
      );
    });

    it('8. is NOT_FOUND across the department boundary', async () => {
      const scoped = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);
      await fx.prisma.document.update({
        where: { id: scoped.id },
        data: { status: DocumentStatus.INDEXED },
      });

      await expectRpc(
        documents.reindexDocument({ id: scoped.id }, outsider()),
        status.NOT_FOUND,
      );
    });
  });

  describe('replace', () => {
    const replacement = (documentId: string) =>
      `organizations/${tenant.organizationId}/documents/${documentId}/${faker.string.uuid()}.pdf`;

    it('1. swaps the file and re-queues, leaving identity alone', async () => {
      const document = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
        isOrganizationWide: true,
      });
      const objectPath = replacement(document.id);
      confirmUpload.mockResolvedValue({
        sizeBytes: 4096,
        contentType: 'text/markdown',
      });

      const result = await documents.replaceDocument(
        { id: document.id, objectPath, ocrLanguages: ['vi'] },
        manager(),
      );

      expect(result.title).toBe(document.title);
      const reloaded = await fx.prisma.document.findUniqueOrThrow({
        where: { id: document.id },
      });
      expect(reloaded.fileUrl).toBe(objectPath);
      expect(reloaded.fileType).toBe('md');
      expect(reloaded.fileSizeBytes).toBe(BigInt(4096));
      expect(reloaded.ocrLanguages).toEqual(['vi']);
      expect(reloaded.status).toBe(DocumentStatus.PENDING);
      expect(await fx.prisma.ingestionJob.count()).toBe(1);
    });

    it('2. **supersedes the OLD path, never the new one**', async () => {
      // The single-character mistake this guards deletes the file the user
      // just uploaded, and it deletes it asynchronously, from another service.
      const document = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
      });
      const objectPath = replacement(document.id);

      await documents.replaceDocument(
        { id: document.id, objectPath, ocrLanguages: [] },
        manager(),
      );

      expect(emitSuperseded).toHaveBeenCalledTimes(1);
      expect(emitSuperseded).toHaveBeenCalledWith(
        document.fileUrl,
        SupersededReason.REPLACED,
      );
    });

    it('3. **resolves open flags as DOCUMENT_REPLACED**', async () => {
      const document = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
      });
      const flag = await createFlag(fx.prisma, document);

      await documents.replaceDocument(
        {
          id: document.id,
          objectPath: replacement(document.id),
          ocrLanguages: [],
        },
        manager(),
      );

      const reloaded = await fx.prisma.documentFlag.findUniqueOrThrow({
        where: { id: flag.id },
      });
      expect(reloaded.resolution).toBe(
        DocumentFlagResolution.DOCUMENT_REPLACED,
      );
      expect(reloaded.resolvedAt).not.toBeNull();
      // Nobody decided this one individually, so no human is named for it.
      expect(reloaded.resolvedById).toBeNull();
    });

    it('4. does NOT overwrite a flag a human already closed', async () => {
      const document = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
      });
      const resolvedAt = new Date('2026-01-01T00:00:00.000Z');
      const flag = await createFlag(fx.prisma, document, {
        resolvedAt,
        resolution: DocumentFlagResolution.DISMISSED,
        resolvedById: tenant.userId,
        resolutionComment: 'Checked the source, the pages are blank.',
      });

      await documents.replaceDocument(
        {
          id: document.id,
          objectPath: replacement(document.id),
          ocrLanguages: [],
        },
        manager(),
      );

      const reloaded = await fx.prisma.documentFlag.findUniqueOrThrow({
        where: { id: flag.id },
      });
      expect(reloaded.resolution).toBe(DocumentFlagResolution.DISMISSED);
      expect(reloaded.resolutionComment).toBe(
        'Checked the source, the pages are blank.',
      );
      expect(reloaded.resolvedAt).toEqual(resolvedAt);
    });

    it('5. refuses a type the parser has no reader for, from STORAGE not the request', async () => {
      // `ReplaceDocumentRequest` carries no content type, so the only way to
      // reach this branch is storage reporting what it actually accepted.
      const document = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
      });
      confirmUpload.mockResolvedValue({
        sizeBytes: 2048,
        contentType: 'application/x-msdownload',
      });

      await expectRpc(
        documents.replaceDocument(
          {
            id: document.id,
            objectPath: replacement(document.id),
            ocrLanguages: [],
          },
          manager(),
        ),
        status.INVALID_ARGUMENT,
      );

      const reloaded = await fx.prisma.document.findUniqueOrThrow({
        where: { id: document.id },
      });
      expect(reloaded.fileUrl).toBe(document.fileUrl);
      expect(emitSuperseded).not.toHaveBeenCalled();
    });

    it('6. **a path storage will not confirm twice never reaches the row**', async () => {
      // The reason no "does this path belong to this document" check exists:
      // `confirmUpload` consumes the `PendingUpload`, so a path already used —
      // by another document's confirm, or by an earlier replace — is NOT_FOUND
      // at storage and the transaction never opens.
      const document = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
      });
      confirmUpload.mockRejectedValue(
        new RpcException({
          code: status.NOT_FOUND,
          message: 'No pending upload for that object path',
        }),
      );

      await expectRpc(
        documents.replaceDocument(
          {
            id: document.id,
            objectPath: replacement(document.id),
            ocrLanguages: [],
          },
          manager(),
        ),
        status.NOT_FOUND,
      );

      expect(await fx.prisma.ingestionJob.count()).toBe(0);
      expect(emitSuperseded).not.toHaveBeenCalled();
    });

    it('7. is NOT_FOUND for a soft-deleted document, and calls STORAGE for nothing', async () => {
      const deleted = await createDocument(fx.prisma, tenant, {
        status: DocumentStatus.INDEXED,
        deletedAt: new Date(),
      });

      await expectRpc(
        documents.replaceDocument(
          {
            id: deleted.id,
            objectPath: replacement(deleted.id),
            ocrLanguages: [],
          },
          manager(),
        ),
        status.NOT_FOUND,
      );

      // The scope check precedes the storage call, so a caller cannot use this
      // route to consume a presign against a document they cannot see.
      expect(confirmUpload).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------- the flag list

  /**
   * The batch contract
   *
   * The property specific to THIS service is the department boundary: a
   * document scoped to a department is invisible outside it, and
   * a batch read that skipped `visibilityScope` would be a way to fetch any
   * document in the tenant one id at a time — including its TITLE, which is
   * usually the sensitive part.
   */
  describe('ListDocumentsByIds / ListDocumentChunksByIds', () => {
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
      // A chunk carries its whole text, so these are the largest
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
          // Denormalized onto the chunk for retrieval, and deliberately NOT
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
