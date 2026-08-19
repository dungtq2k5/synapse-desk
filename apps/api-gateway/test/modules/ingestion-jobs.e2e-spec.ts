import { of, throwError } from 'rxjs';
import { faker } from '@faker-js/faker';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { IngestionJobStatus as ProtoIngestionJobStatus } from '@synapsedesk/grpc-proto';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';
import { grpcError, timestamp, wirePage } from '../fixtures/wire';

describe('Ingestion jobs at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const jobId = faker.string.uuid();
  const documentId = faker.string.uuid();

  const wireJob = (overrides: Record<string, unknown> = {}) => ({
    id: jobId,
    documentId,
    bullmqJobId: 'bull-1',
    status: ProtoIngestionJobStatus.INGESTION_JOB_STATUS_FAILED,
    errorLog: 'the parser gave up',
    processedAt: timestamp(),
    createdAt: timestamp(),
    ...overrides,
  });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  }, 30_000);

  beforeEach(() => jest.clearAllMocks());

  afterAll(() => fx.close());

  describe('GET /ingestion-jobs', () => {
    it('1. returns the paginated ENVELOPE, not a bare array', async () => {
      fx.stubs.document.listIngestionJobs.mockReturnValue(
        of(wirePage([wireJob()])),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.read'],
      }).get(`${API}/ingestion-jobs`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items[0]).toMatchObject({
        id: jobId,
        documentId,
        status: 'FAILED',
        errorLog: 'the parser gave up',
      });
      expect(res.body.data.meta).toBeDefined();
    });

    it('**2. a status filter is forwarded as the PROTO enum**', async () => {
      fx.stubs.document.listIngestionJobs.mockReturnValue(of(wirePage([])));

      await authenticatedAgent(fx.app, { permissionCodes: ['document.read'] })
        .get(`${API}/ingestion-jobs`)
        .query({ status: 'CANCELLED' });

      const [[request]] = fx.stubs.document.listIngestionJobs.mock.calls;
      expect(request).toMatchObject({
        status: ProtoIngestionJobStatus.INGESTION_JOB_STATUS_CANCELLED,
      });
    });

    it('3. an ABSENT status forwards UNSPECIFIED, which means no filter', async () => {
      fx.stubs.document.listIngestionJobs.mockReturnValue(of(wirePage([])));

      await authenticatedAgent(fx.app, {
        permissionCodes: ['document.read'],
      }).get(`${API}/ingestion-jobs`);

      const [[request]] = fx.stubs.document.listIngestionJobs.mock.calls;
      expect(request).toMatchObject({
        status: ProtoIngestionJobStatus.INGESTION_JOB_STATUS_UNSPECIFIED,
        documentId: '',
      });
    });

    it('4. REJECTS a status outside the enum', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.read'],
      })
        .get(`${API}/ingestion-jobs`)
        .query({ status: 'EXPLODED' });

      expect(res.status).toBe(400);
      expect(fx.stubs.document.listIngestionJobs).not.toHaveBeenCalled();
    });

    it('5. refuses a member without `document.read`', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [],
      }).get(`${API}/ingestion-jobs`);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /ingestion-jobs/:id', () => {
    it('6. **a running job reports `processedAt: null`**', async () => {
      // proto3 has no null, so an unset timestamp arrives as `undefined` — the
      // JSON key set has to stay stable for clients regardless.
      fx.stubs.document.getIngestionJob.mockReturnValue(
        of(
          wireJob({
            processedAt: undefined,
            errorLog: '',
            status: ProtoIngestionJobStatus.INGESTION_JOB_STATUS_EMBEDDING,
          }),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.read'],
      }).get(`${API}/ingestion-jobs/${jobId}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('processedAt', null);
      expect(res.body.data).toHaveProperty('errorLog', null);
      expect(res.body.data.status).toBe('EMBEDDING');
    });

    it('**6b. CAPS a runaway `error_log` on the way out**', async () => {
      // `fail()` stores whatever was thrown, and an embedding-API 4xx body
      // routinely echoes a prefix of the input it rejected — which is document
      // text. The cap bounds how much of that reaches a `document.read` holder.
      fx.stubs.document.getIngestionJob.mockReturnValue(
        of(wireJob({ errorLog: 'x'.repeat(5_000) })),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.read'],
      }).get(`${API}/ingestion-jobs/${jobId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.errorLog.length).toBeLessThan(600);
      // Marked, so a reader knows the message is cut rather than complete.
      expect(res.body.data.errorLog.endsWith('…')).toBe(true);
    });

    it('6c. leaves an ordinary message exactly as the peer sent it', async () => {
      fx.stubs.document.getIngestionJob.mockReturnValue(
        of(wireJob({ errorLog: 'the parser gave up' })),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.read'],
      }).get(`${API}/ingestion-jobs/${jobId}`);

      expect(res.body.data.errorLog).toBe('the parser gave up');
    });

    it('7. REJECTS a non-UUID id before reaching the peer', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.read'],
      }).get(`${API}/ingestion-jobs/not-a-uuid`);

      expect(res.status).toBe(400);
      expect(fx.stubs.document.getIngestionJob).not.toHaveBeenCalled();
    });
  });

  describe('GET /documents/:id/ingestion-jobs', () => {
    it('8. is served by the DOCUMENTS controller, as a sub-resource', async () => {
      fx.stubs.document.listDocumentIngestionJobs.mockReturnValue(
        of(wirePage([wireJob()])),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.read'],
      }).get(`${API}/documents/${documentId}/ingestion-jobs`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);

      const [[request]] =
        fx.stubs.document.listDocumentIngestionJobs.mock.calls;
      expect(request).toMatchObject({ id: documentId });
    });

    it('9. does NOT collide with GET /documents/:id', async () => {
      // Its own path segment, so declaration order does not decide this one.
      fx.stubs.document.listDocumentIngestionJobs.mockReturnValue(
        of(wirePage([])),
      );

      await authenticatedAgent(fx.app, { permissionCodes: ['document.read'] })
        .get(`${API}/documents/${documentId}/ingestion-jobs`)
        .expect(200);

      expect(fx.stubs.document.getDocument).not.toHaveBeenCalled();
    });
  });

  describe('POST /ingestion-jobs/:id/retry', () => {
    it('10. **returns the NEW job, not the one in the path**', async () => {
      const retryId = faker.string.uuid();
      fx.stubs.document.retryIngestionJob.mockReturnValue(
        of(
          wireJob({
            id: retryId,
            bullmqJobId: retryId,
            errorLog: '',
            processedAt: undefined,
            status: ProtoIngestionJobStatus.INGESTION_JOB_STATUS_QUEUED,
          }),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.reindex'],
      }).post(`${API}/ingestion-jobs/${jobId}/retry`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: retryId, status: 'QUEUED' });

      const [[request]] = fx.stubs.document.retryIngestionJob.mock.calls;
      expect(request).toMatchObject({ id: jobId });
    });

    it('**11. `document.read` is not enough — retry costs money**', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.read'],
      }).post(`${API}/ingestion-jobs/${jobId}/retry`);

      expect(res.status).toBe(403);
      expect(fx.stubs.document.retryIngestionJob).not.toHaveBeenCalled();
    });

    it('12. **a refused precondition reaches the client as 400, not 500**', async () => {
      // The peer refuses a COMPLETED or still-running job with
      // FAILED_PRECONDITION; an unmapped code would collapse to a 500 and hide
      // the reason.
      fx.stubs.document.retryIngestionJob.mockReturnValue(
        throwError(() =>
          grpcError(
            GrpcStatus.FAILED_PRECONDITION,
            'Ingestion job is still parsing',
          ),
        ),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.reindex'],
      }).post(`${API}/ingestion-jobs/${jobId}/retry`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('parsing');
    });
  });

  describe('DELETE /ingestion-jobs/:id', () => {
    it('13. **answers 204 with no body at all**', async () => {
      // The wire's `cancelled` flag is the transport's stand-in for void; a
      // client that received it would have a field that is always true.
      fx.stubs.document.cancelIngestionJob.mockReturnValue(
        of({ cancelled: true }),
      );

      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.reindex'],
      }).delete(`${API}/ingestion-jobs/${jobId}`);

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});

      const [[request]] = fx.stubs.document.cancelIngestionJob.mock.calls;
      expect(request).toMatchObject({ id: jobId });
    });

    it('14. refuses a member holding only `document.read`', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.read'],
      }).delete(`${API}/ingestion-jobs/${jobId}`);

      expect(res.status).toBe(403);
      expect(fx.stubs.document.cancelIngestionJob).not.toHaveBeenCalled();
    });

    it('15. REJECTS a non-UUID id before reaching the peer', async () => {
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['document.reindex'],
      }).delete(`${API}/ingestion-jobs/not-a-uuid`);

      expect(res.status).toBe(400);
      expect(fx.stubs.document.cancelIngestionJob).not.toHaveBeenCalled();
    });
  });
});
