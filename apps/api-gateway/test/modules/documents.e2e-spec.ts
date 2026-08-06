import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  DocumentStatus,
  MAX_DOCUMENT_BYTES,
  withHttpStatus,
} from '@synapsedesk/common';
import {
  API,
  E2eFixture,
  anonymousAgent,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { grpcError, timestamp, wirePage } from '../fixtures/wire';

/**
 * Domain C's document surface at the HTTP boundary.
 *
 * ingestion-service is stubbed: the quota gate, the visibility predicate and
 * the fan-out ordering all have their own suite against a real database. What
 * is under test here is what only exists at this layer — the READ/WRITE
 * permission split, the two-layer upload validation, and the route ordering
 * that `presign` and `storage` would otherwise lose to `:id`.
 */
describe('§3.1 Documents at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const documentId = faker.string.uuid();
  const chunkId = faker.string.uuid();

  const wireDocument = (overrides: Record<string, unknown> = {}) => ({
    id: documentId,
    organizationId: faker.string.uuid(),
    createdById: faker.string.uuid(),
    title: '2026 Employee Handbook',
    fileUrl: 'organizations/o/documents/d/abc.pdf',
    fileType: 'pdf',
    fileSizeBytes: 2048,
    isOrganizationWide: true,
    status: DocumentStatus.PENDING,
    departmentIds: [],
    chunkCount: 0,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    deletedAt: undefined,
    deletedById: undefined,
    ...overrides,
  });

  const presign = {
    contentType: 'application/pdf',
    sizeBytes: 2048,
    fileName: 'handbook.pdf',
  };

  const confirm = {
    objectPath: 'organizations/o/documents/d/abc.pdf',
    title: '2026 Employee Handbook',
  };

  beforeAll(async () => {
    await flushTestRedis();
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  describe('GET /documents', () => {
    it('1. is readable by a member with NO permissions', async () => {
      // A knowledge base exists to be read by everyone in the tenant. Gating
      // reads would mean an agent needed a grant to look something up, and the
      // narrowing that matters — org-wide ∪ their departments — happens in
      // ingestion-service, per row rather than per route.
      fx.stubs.document.listDocuments.mockReturnValue(
        of({ items: [wireDocument()], meta: wirePage([]).meta }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/documents`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
    });

    it('2. renders an absent deletedAt as null, never missing', async () => {
      fx.stubs.document.listDocuments.mockReturnValue(
        of({ items: [wireDocument()], meta: wirePage([]).meta }),
      );

      const res = await authenticatedAgent(fx.app).get(`${API}/documents`);

      expect(res.body.data.items[0]).toHaveProperty('deletedAt', null);
      expect(res.body.data.items[0]).toHaveProperty('deletedById', null);
    });

    it('3. forwards ABSENT filters as empty strings', async () => {
      fx.stubs.document.listDocuments.mockReturnValue(
        of({ items: [], meta: wirePage([]).meta }),
      );

      await authenticatedAgent(fx.app).get(`${API}/documents`);

      const [request] = fx.stubs.document.listDocuments.mock.calls[0];
      expect(request.status).toBe('');
      expect(request.departmentId).toBe('');
      expect(request.includeDeleted).toBe(false);
    });

    it('4. REJECTS a status outside the enum', async () => {
      const res = await authenticatedAgent(fx.app).get(
        `${API}/documents?status=NONSENSE`,
      );

      expect(res.status).toBe(400);
      expect(fx.stubs.document.listDocuments).not.toHaveBeenCalled();
    });
  });

  describe('POST /documents/presign', () => {
    it('1. requires document.create', async () => {
      const res = await authenticatedAgent(fx.app, { permissionCodes: [] })
        .post(`${API}/documents/presign`)
        .send(presign);

      expect(res.status).toBe(403);
      expect(fx.stubs.document.presignDocument).not.toHaveBeenCalled();
    });

    it('2. answers 200 with a URL — nothing is CREATED yet', async () => {
      // A 201 would tell a client the document existed when all it has is
      // permission to upload one. The row appears at confirm.
      fx.stubs.document.presignDocument.mockReturnValue(
        of({
          uploadUrl: 'https://storage.example/put',
          objectPath: 'organizations/o/documents/d/abc.pdf',
          expiresAt: timestamp(),
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.create'],
      })
        .post(`${API}/documents/presign`)
        .send(presign);

      expect(res.status).toBe(200);
      expect(res.body.data.uploadUrl).toBeTruthy();
    });

    it('3. REJECTS a disallowed type before any network call', async () => {
      // The first of two layers. storage-service checks the same list against
      // its own `PURPOSE_POLICY`; neither can be dropped because the other
      // exists, and this one saves a network hop.
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.create'],
      })
        .post(`${API}/documents/presign`)
        .send({ ...presign, contentType: 'application/x-httpd-php' });

      expect(res.status).toBe(400);
      expect(fx.stubs.document.presignDocument).not.toHaveBeenCalled();
    });

    it('4. REJECTS a file over the cap and ACCEPTS one exactly at it', async () => {
      fx.stubs.document.presignDocument.mockReturnValue(
        of({
          uploadUrl: 'u',
          objectPath: 'p',
          expiresAt: timestamp(),
        }),
      );
      const client = authenticatedAgent(fx.app, {
        permissionCodes: ['document.create'],
      });

      const over = await client
        .post(`${API}/documents/presign`)
        .send({ ...presign, sizeBytes: MAX_DOCUMENT_BYTES + 1 });
      const at = await client
        .post(`${API}/documents/presign`)
        .send({ ...presign, sizeBytes: MAX_DOCUMENT_BYTES });

      expect(over.status).toBe(400);
      // The boundary. Off-by-one here rejects a legal 25 MB PDF and nobody
      // notices until somebody uploads one.
      expect(at.status).toBe(200);
    });

    it('5. maps an over-quota refusal to 429, not 403', async () => {
      // The caller IS allowed to upload documents; they have run out of room.
      // A 403 would send an admin looking at role grants.
      fx.stubs.document.presignDocument.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.RESOURCE_EXHAUSTED, 'Storage quota exceeded'),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.create'],
      })
        .post(`${API}/documents/presign`)
        .send(presign);

      expect(res.status).toBe(429);
    });

    it('6. honours a 402 HINT over the code table, and strips the marker', async () => {
      // The AI cap answers 402 Payment Required, which no gRPC code means — so
      // the status rides in the details behind a marker the filter strips. This
      // asserts BOTH halves: that the override wins, and that the marker never
      // reaches the client. A leaked "[http:402]" in a user-facing message
      // would be the obvious symptom of getting this half right and that half
      // wrong.
      fx.stubs.document.presignDocument.mockReturnValue(
        throwError(() =>
          grpcError(
            GrpcStatus.RESOURCE_EXHAUSTED,
            withHttpStatus(402, 'This workspace has used its AI allowance'),
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.create'],
      })
        .post(`${API}/documents/presign`)
        .send(presign);

      expect(res.status).toBe(402);
      expect(res.body.error).toMatch(
        /^This workspace has used its AI allowance/,
      );
      expect(res.body.error).not.toContain('[http:');
    });
  });

  describe('POST /documents/confirm', () => {
    it('1. creates the document and answers 201', async () => {
      fx.stubs.document.confirmDocument.mockReturnValue(of(wireDocument()));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.create'],
      })
        .post(`${API}/documents/confirm`)
        .send(confirm);

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe(DocumentStatus.PENDING);
    });

    it('2. defaults isOrganizationWide to TRUE', async () => {
      // The permissive default is deliberate: a knowledge base whose documents
      // defaulted to invisible looks broken to everyone who did not also
      // configure departments, and the failure mode of that default is a
      // support ticket rather than a disclosure.
      fx.stubs.document.confirmDocument.mockReturnValue(of(wireDocument()));

      await authenticatedAgent(fx.app, { permissionCodes: ['document.create'] })
        .post(`${API}/documents/confirm`)
        .send(confirm);

      const [request] = fx.stubs.document.confirmDocument.mock.calls[0];
      expect(request.isOrganizationWide).toBe(true);
      expect(request.departmentIds).toEqual([]);
    });

    it('3. REJECTS a non-UUID department id', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.create'],
      })
        .post(`${API}/documents/confirm`)
        .send({
          ...confirm,
          isOrganizationWide: false,
          departmentIds: ['nope'],
        });

      expect(res.status).toBe(400);
    });

    it('4. maps a replayed confirm to 409', async () => {
      fx.stubs.document.confirmDocument.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.ALREADY_EXISTS, 'Already confirmed'),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.create'],
      })
        .post(`${API}/documents/confirm`)
        .send(confirm);

      expect(res.status).toBe(409);
    });
  });

  describe('route ordering', () => {
    it('1. GET /documents/storage is not swallowed by :id', async () => {
      // `:id` would match `storage` and `ParseUUIDPipe` would turn it into a
      // 400 that reads as a client bug rather than a routing mistake. The same
      // hazard `bulk/status` hit in Domain B and `by-number` before that.
      fx.stubs.document.getStorageUsage.mockReturnValue(
        of({ usedBytes: 1000, limitBytes: 5000, documentCount: 2 }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.read'],
      }).get(`${API}/documents/storage`);

      expect(res.status).toBe(200);
      expect(res.body.data.usedBytes).toBe(1000);
      expect(fx.stubs.document.getDocument).not.toHaveBeenCalled();
    });

    it('2. POST /documents/presign is not swallowed by :id', async () => {
      fx.stubs.document.presignDocument.mockReturnValue(
        of({ uploadUrl: 'u', objectPath: 'p', expiresAt: timestamp() }),
      );

      await authenticatedAgent(fx.app, { permissionCodes: ['document.create'] })
        .post(`${API}/documents/presign`)
        .send(presign);

      expect(fx.stubs.document.presignDocument).toHaveBeenCalledTimes(1);
    });

    it('3. GET /documents/:id/chunks/:chunkId reaches the chunk route', async () => {
      fx.stubs.document.getDocumentChunk.mockReturnValue(
        of({
          id: chunkId,
          documentId,
          chunkIndex: 0,
          contentText: 'text',
          pageNumber: 4,
          tokenCount: 128,
          vectorPointId: undefined,
          createdAt: timestamp(),
        }),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/documents/${documentId}/chunks/${chunkId}`,
      );

      expect(res.status).toBe(200);
      expect(fx.stubs.document.listDocumentChunks).not.toHaveBeenCalled();
    });
  });

  describe('write permissions', () => {
    it('1. PATCH requires document.update', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.read'],
      })
        .patch(`${API}/documents/${documentId}`)
        .send({ title: 'Renamed' });

      expect(res.status).toBe(403);
    });

    it('2. DELETE requires document.delete and answers 204', async () => {
      fx.stubs.document.deleteDocument.mockReturnValue(of({}));

      const refused = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.update'],
      }).delete(`${API}/documents/${documentId}`);
      const allowed = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.delete'],
      }).delete(`${API}/documents/${documentId}`);

      expect(refused.status).toBe(403);
      expect(allowed.status).toBe(204);
    });

    it('3. PUT departments requires document.share, NOT document.update', async () => {
      // Sharing is a different right from editing: renaming a document and
      // changing who can see it are not the same decision, and one permission
      // covering both would grant the second to anyone who could do the first.
      fx.stubs.document.setDocumentDepartments.mockReturnValue(
        of(wireDocument()),
      );

      const refused = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.update'],
      })
        .put(`${API}/documents/${documentId}/departments`)
        .send({ departmentIds: [faker.string.uuid()] });
      const allowed = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.share'],
      })
        .put(`${API}/documents/${documentId}/departments`)
        .send({ departmentIds: [faker.string.uuid()] });

      expect(refused.status).toBe(403);
      expect(allowed.status).toBe(200);
    });

    it('4. maps the org-wide scoping conflict to 409', async () => {
      fx.stubs.document.setDocumentDepartments.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.ABORTED, 'This document is organization-wide'),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.share'],
      })
        .put(`${API}/documents/${documentId}/departments`)
        .send({ departmentIds: [faker.string.uuid()] });

      expect(res.status).toBe(409);
    });

    it('5. restore requires document.delete — the recycle bin is one right', async () => {
      fx.stubs.document.restoreDocument.mockReturnValue(of(wireDocument()));

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.delete'],
      }).post(`${API}/documents/${documentId}/restore`);

      expect(res.status).toBe(200);
    });

    it('6. maps a taken-hash restore to 409', async () => {
      fx.stubs.document.restoreDocument.mockReturnValue(
        throwError(() =>
          grpcError(
            GrpcStatus.ALREADY_EXISTS,
            'Another document holds that slot',
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.delete'],
      }).post(`${API}/documents/${documentId}/restore`);

      expect(res.status).toBe(409);
    });
  });

  describe('download and chunks', () => {
    it('1. download is open to any member who can see the document', async () => {
      fx.stubs.document.downloadDocument.mockReturnValue(
        of({
          downloadUrl: 'https://storage.example/signed',
          expiresAt: timestamp(),
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/documents/${documentId}/download`);

      expect(res.status).toBe(200);
      expect(res.body.data.downloadUrl).toBeTruthy();
    });

    it('2. a chunk with no vectorPointId renders NULL, not missing', async () => {
      // The absence is meaningful — that chunk is not retrievable yet — so the
      // REST contract reports it rather than dropping the key.
      fx.stubs.document.getDocumentChunk.mockReturnValue(
        of({
          id: chunkId,
          documentId,
          chunkIndex: 0,
          contentText: 'text',
          pageNumber: undefined,
          tokenCount: 128,
          vectorPointId: undefined,
          createdAt: timestamp(),
        }),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/documents/${documentId}/chunks/${chunkId}`,
      );

      expect(res.body.data).toHaveProperty('vectorPointId', null);
      expect(res.body.data).toHaveProperty('pageNumber', null);
    });

    it('3. the citation deep-link needs no permission', async () => {
      // A citation in an AI answer is useless if following it needs a grant the
      // reader does not have.
      fx.stubs.document.getDocumentChunk.mockReturnValue(
        of({
          id: chunkId,
          documentId,
          chunkIndex: 0,
          contentText: 'text',
          pageNumber: 1,
          tokenCount: 10,
          vectorPointId: faker.string.uuid(),
          createdAt: timestamp(),
        }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/documents/${documentId}/chunks/${chunkId}`);

      expect(res.status).toBe(200);
    });
  });

  describe('access', () => {
    it('1. refuses an ANONYMOUS caller', async () => {
      const res = await anonymousAgent(fx.app).get(`${API}/documents`);

      expect(res.status).toBe(401);
    });

    it('2. rejects a NON-UUID document id', async () => {
      const res = await authenticatedAgent(fx.app).get(
        `${API}/documents/not-a-uuid`,
      );

      expect(res.status).toBe(400);
    });

    it('3. maps a cross-tenant read to 404', async () => {
      fx.stubs.document.getDocument.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.NOT_FOUND, 'No document with that id'),
        ),
      );

      const res = await authenticatedAgent(fx.app).get(
        `${API}/documents/${documentId}`,
      );

      expect(res.status).toBe(404);
    });
  });
});
