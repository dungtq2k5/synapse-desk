import {
  AnalyticsExportKind as ProtoAnalyticsExportKind,
  fromProtoAnalyticsExportStatus,
  toProtoAnalyticsExportKind,
} from '@synapsedesk/grpc-proto';
import { status } from '@grpc/grpc-js';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import {
  AnalyticsExportKind,
  AnalyticsExportStatus,
} from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest, memberContext } from '../utils';
import { buildTenant, createTicket, TenantFixture } from '../factories';
import { AnalyticsExportFacade } from '../../src/modules/analytics/analytics-export.facade';
import { AnalyticsExportProcessor } from '../../src/modules/analytics/analytics-export.processor';
import { TicketRollupJob } from '../../src/modules/analytics/ticket-rollup.job';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';
import { StorageReferenceService } from '../../src/modules/storage-client/storage-reference.service';

/**
 * The async export.
 *
 * Two properties carry the section, and neither is about CSV:
 *
 *   - **An export is a SNAPSHOT with a timestamp in it.** Two people exporting
 *     "last quarter" a week apart get different numbers if a backfill ran
 *     between, and without the provenance header the only thing they can do is
 *     argue.
 *   - **A failed export reports FAILURE rather than an empty file.** An empty
 *     CSV reads as "no data", which is a wrong answer rather than an error.
 */
describe('§5 The analytics export (e2e)', () => {
  let fx: E2eFixture;
  let facade: AnalyticsExportFacade;
  let processor: AnalyticsExportProcessor;
  let rollup: TicketRollupJob;

  let presignExport: jest.SpyInstance;
  let confirmExportUpload: jest.SpyInstance;
  let resolveExportUrl: jest.SpyInstance;
  let uploadedBodies: string[];

  let tenant: TenantFixture;

  const OBJECT_PATH = 'organizations/o/exports/e/analytics.csv';
  const DOWNLOAD_URL = 'https://storage.example/signed-get';

  const caller = (t = tenant) =>
    memberContext({ id: t.agentId, organizationId: t.organizationId }, [
      'analytics.read',
    ]);

  const at = (iso: string) => new Date(iso);

  const request = (overrides = {}) =>
    facade.create(
      {
        kind: toProtoAnalyticsExportKind(AnalyticsExportKind.TICKET_DAILY),
        from: '2026-03-01',
        to: '2026-03-31',
        ...overrides,
      },
      caller(),
    );

  /** Seeds a rollup row so there is something to export. */
  const seedRollup = async () => {
    await createTicket(fx.prisma, tenant, {
      createdAt: at('2026-03-02T09:00:00.000Z'),
    });
    await rollup.backfill(
      at('2026-03-01T00:00:00.000Z'),
      at('2026-03-05T00:00:00.000Z'),
    );
  };

  /**
   * A `fetch` that records the PUT body and succeeds.
   *
   * Re-installed every test rather than once: a test that replaces it to
   * simulate a rejected upload would otherwise leave the replacement in place
   * for every test after it — which is precisely how test 13 first failed, on
   * an error test 12 had injected.
   */
  /** The default upload result: a plain 200. */
  type UploadResult = { ok: boolean; status: number; statusText: string };

  const OK_UPLOAD: UploadResult = { ok: true, status: 200, statusText: 'OK' };

  const stubUpload = (
    // Named, not an inline literal. A literal default is re-evaluated per call,
    // so every caller silently gets its OWN object — which reads as a shared
    // default and is not one. That difference is invisible until something
    // mutates it, and then the test that mutated it passes while the next one
    // fails for a reason that points nowhere near the mutation.
    response: UploadResult = OK_UPLOAD,
  ) => {
    global.fetch = jest.fn((_url: unknown, init?: { body?: unknown }) => {
      if (response.ok) {
        uploadedBodies.push(
          Buffer.from(init?.body as Uint8Array).toString('utf8'),
        );
      }

      return Promise.resolve(response);
    }) as unknown as typeof fetch;
  };

  /** Runs the worker for the one queued export. */
  const runWorker = (exportId: string) =>
    processor.process({
      name: 'generate-export',
      data: { exportId },
    } as never);

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    facade = fx.moduleRef.get(AnalyticsExportFacade);
    processor = fx.moduleRef.get(AnalyticsExportProcessor);
    rollup = fx.moduleRef.get(TicketRollupJob);

    jest
      .spyOn(
        fx.moduleRef.get(AuthReferenceService),
        'listOrganizationTimezones',
      )
      .mockResolvedValue(new Map());

    const storage = fx.moduleRef.get(StorageReferenceService);
    presignExport = jest.spyOn(storage, 'presignExport');
    confirmExportUpload = jest.spyOn(storage, 'confirmExportUpload');
    resolveExportUrl = jest.spyOn(storage, 'resolveExportUrl');

    // The bytes never reach a bucket. Capturing the PUT body is what lets the
    // provenance assertions read the actual file rather than a description of
    // one. Installed per test by `stubUpload()` below.
    uploadedBodies = [];
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();
    uploadedBodies = [];

    tenant = buildTenant();
    presignExport.mockResolvedValue({
      uploadUrl: 'https://storage.example/signed-put',
      objectPath: OBJECT_PATH,
      expiresAt: new Date(Date.now() + 600_000),
    });
    confirmExportUpload.mockResolvedValue(undefined);
    resolveExportUrl.mockResolvedValue(DOWNLOAD_URL);
    stubUpload();
  });

  afterAll(() => fx.close());

  describe('the job', () => {
    it('1. Returns a job id IMMEDIATELY; the file appears later', async () => {
      // A synchronous export of a quarter would hold a request open for the
      // length of a bulk read — the hot-path competition this whole design
      // exists to avoid, arriving through the one endpoint that looks like a
      // read.
      await seedRollup();

      const created = await request();

      expect(created.id).toBeTruthy();
      expect(fromProtoAnalyticsExportStatus(created.status)).toBe(
        AnalyticsExportStatus.PENDING,
      );
      expect(created.downloadUrl).toBeUndefined();
      // Nothing uploaded yet.
      expect(presignExport).not.toHaveBeenCalled();
    });

    it('2. Produces the file, and the URL appears once it is READY', async () => {
      await seedRollup();
      const created = await request();

      await runWorker(created.id);
      const ready = await facade.get(created.id, caller());

      expect(fromProtoAnalyticsExportStatus(ready.status)).toBe(
        AnalyticsExportStatus.READY,
      );
      expect(ready.downloadUrl).toBe(DOWNLOAD_URL);
      expect(ready.rowCount).toBe(1);
      expect(confirmExportUpload).toHaveBeenCalledWith(
        OBJECT_PATH,
        tenant.organizationId,
      );
    });

    it('3. Mints the download URL PER REQUEST rather than storing it', async () => {
      // **A signed URL to a file containing a tenant's full ticket history is a
      // credential.** Storing one would turn a database read into a durable
      // secret; minting it per request is what makes the short expiry mean
      // anything.
      await seedRollup();
      const created = await request();
      await runWorker(created.id);

      await facade.get(created.id, caller());
      await facade.get(created.id, caller());

      expect(resolveExportUrl).toHaveBeenCalledTimes(2);

      const row = await fx.prisma.analyticsExport.findUniqueOrThrow({
        where: { id: created.id },
      });
      // The PATH is stored; the URL is not.
      expect(row.objectPath).toBe(OBJECT_PATH);
      expect(JSON.stringify(row)).not.toContain(DOWNLOAD_URL);
    });

    it('4. Another tenant’s job id is 404, not 403', async () => {
      // A 403 confirms the job exists, which turns polling into an oracle for
      // how much a competitor exports.
      await seedRollup();
      const created = await request();

      await expectRpc(
        facade.get(created.id, caller(buildTenant())),
        status.NOT_FOUND,
      );
    });

    it('5. Refuses an unknown export kind', async () => {
      await expectRpc(
        // `'EVERYTHING'` is unexpressible now; UNRECOGNIZED is the case
        // that survives — a kind some newer build knows and this one cannot
        // produce.
        request({ kind: ProtoAnalyticsExportKind.UNRECOGNIZED }),
        status.INVALID_ARGUMENT,
      );
    });
  });

  describe('the file', () => {
    it('6. **Records the generation time and the ROLLUP RUN**', async () => {
      // The disputed-number guard. Without it, two exports of "last quarter"
      // that disagree are an argument with nothing to settle it.
      await seedRollup();
      const created = await request();
      await runWorker(created.id);

      const [csv] = uploadedBodies;

      expect(csv).toContain('# generated_at=');
      expect(csv).toContain('# rollup_computed_at=');
      expect(csv).toContain(`# export_id=${created.id}`);
      expect(csv).toContain('# range=2026-03-01..2026-03-31');
      // And the same value is on the row, so a caller polling the API sees what
      // the file says without downloading it.
      const ready = await facade.get(created.id, caller());
      expect(ready.rollupComputedAt).toBeDefined();
    });

    it('7. Exports SUMS AND COUNTS, never a computed rate', async () => {
      // A spreadsheet that recomputed a rate differently from the dashboard is
      // exactly the disagreement this exists to prevent. Shipping the
      // inputs lets a reader derive whichever they want from the same numbers.
      await seedRollup();
      const created = await request();
      await runWorker(created.id);

      const [csv] = uploadedBodies;
      const header = csv.split('\n').find((line) => line.startsWith('day,'));

      expect(header).toContain('resolution_seconds_sum');
      expect(header).toContain('resolution_count');
      // Whole column names, anchored on the separators. A bare `/_rate/` also
      // matches `citation_rated_count`, which is a legitimate COUNT — the kind
      // of false positive that gets a test deleted rather than fixed.
      const columns = (header ?? '').split(',');
      expect(
        columns.filter((column) =>
          /^(deflection|csat)|_rate$|_avg$|^avg_/.test(column),
        ),
      ).toEqual([]);
    });

    it('8. Exports the AGENT rollup when asked for it', async () => {
      await createTicket(fx.prisma, tenant, {
        currentAssigneeId: tenant.agentId,
        createdAt: at('2026-03-02T09:00:00.000Z'),
        resolvedAt: at('2026-03-02T11:00:00.000Z'),
        status: 'RESOLVED',
      });
      await rollup.backfill(
        at('2026-03-01T00:00:00.000Z'),
        at('2026-03-05T00:00:00.000Z'),
      );

      const created = await request({
        kind: toProtoAnalyticsExportKind(AnalyticsExportKind.AGENT_DAILY),
      });
      await runWorker(created.id);

      const [csv] = uploadedBodies;
      expect(csv).toContain('day,agent_id,assigned,resolved');
      expect(csv).toContain(tenant.agentId);
    });

    it('9. Contains ONLY the requesting tenant’s rows', async () => {
      const other = buildTenant();
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });
      await createTicket(fx.prisma, other, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });
      await rollup.backfill(
        at('2026-03-01T00:00:00.000Z'),
        at('2026-03-05T00:00:00.000Z'),
      );

      const created = await request();
      await runWorker(created.id);

      const ready = await facade.get(created.id, caller());
      // Two tenants each have one rollup row; this file must carry one.
      expect(ready.rowCount).toBe(1);
    });

    it('10. An EMPTY range produces a header-only file, not a failure', async () => {
      // A quiet quarter is a real answer. The provenance header is what tells a
      // reader the export ran and found nothing, rather than leaving them to
      // guess from a zero-byte file.
      const created = await request();
      await runWorker(created.id);

      const ready = await facade.get(created.id, caller());
      const [csv] = uploadedBodies;

      expect(fromProtoAnalyticsExportStatus(ready.status)).toBe(
        AnalyticsExportStatus.READY,
      );
      expect(ready.rowCount).toBe(0);
      expect(csv).toContain('# generated_at=');
      expect(csv).toContain('# rollup_computed_at=none');
    });
  });

  describe('failure', () => {
    it('11. **Reports FAILURE rather than producing an empty file**', async () => {
      // An empty CSV reads as "no data", which is a wrong answer rather than an
      // error — and the reader has no way to tell the difference.
      await seedRollup();
      presignExport.mockRejectedValue(new Error('storage is down'));

      const created = await request();

      await expect(runWorker(created.id)).rejects.toThrow('storage is down');

      const failed = await facade.get(created.id, caller());
      expect(fromProtoAnalyticsExportStatus(failed.status)).toBe(
        AnalyticsExportStatus.FAILED,
      );
      expect(failed.error).toContain('storage is down');
      expect(failed.downloadUrl).toBeUndefined();
      expect(uploadedBodies).toHaveLength(0);
    });

    it('12. Reports failure when the UPLOAD is rejected', async () => {
      await seedRollup();
      stubUpload({ ok: false, status: 403, statusText: 'Forbidden' });

      const created = await request();
      await expect(runWorker(created.id)).rejects.toThrow();

      const failed = await facade.get(created.id, caller());
      expect(fromProtoAnalyticsExportStatus(failed.status)).toBe(
        AnalyticsExportStatus.FAILED,
      );
      expect(failed.error).toContain('403');
    });

    it('13. A RETRY after a failure can still succeed', async () => {
      // The reason this is a BullMQ job rather than a detached promise: an
      // export interrupted by a restart is retried rather than lost, and a row
      // stuck at PENDING forever is what makes people stop trusting the button.
      await seedRollup();
      presignExport.mockRejectedValueOnce(new Error('transient'));

      const created = await request();
      await expect(runWorker(created.id)).rejects.toThrow('transient');
      expect(
        fromProtoAnalyticsExportStatus(
          (await facade.get(created.id, caller())).status,
        ),
      ).toBe(AnalyticsExportStatus.FAILED);

      // The retry BullMQ would perform.
      await runWorker(created.id);

      const ready = await facade.get(created.id, caller());
      expect(fromProtoAnalyticsExportStatus(ready.status)).toBe(
        AnalyticsExportStatus.READY,
      );
      expect(ready.error).toBeUndefined();
    });
  });
});
