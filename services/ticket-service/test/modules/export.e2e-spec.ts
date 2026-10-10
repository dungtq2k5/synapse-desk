import { faker } from '@faker-js/faker';
import {
  ExportKind as ProtoExportKind,
  fromProtoExportStatus,
  toProtoExportKind,
} from '@synapsedesk/grpc-proto';
import { status } from '@grpc/grpc-js';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import {
  ExportKind,
  ExportStatus,
  compareAlphabetically,
} from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest, memberContext } from '../utils';
import { buildTenant, createTicket, TenantFixture } from '../factories';
import { ExportFacade } from '../../src/modules/analytics/export.facade';
import { ExportProcessor } from '../../src/modules/analytics/export.processor';
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
describe('The analytics export (e2e)', () => {
  let fx: E2eFixture;
  let facade: ExportFacade;
  let processor: ExportProcessor;
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
        kind: toProtoExportKind(ExportKind.TICKET_DAILY),
        from: '2026-03-01',
        to: '2026-03-31',
        filters: '',
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
    facade = fx.moduleRef.get(ExportFacade);
    processor = fx.moduleRef.get(ExportProcessor);
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

  describe('requesting', () => {
    it('**0a. two callers with DIFFERENT visibility get different exports**', async () => {
      // The dedupe matched on the range alone, so an agent asking for what an
      // admin had just asked for was handed the ADMIN's export id — a file
      // rendered under `unrestricted: true`, containing every ticket in the
      // tenant. Latent today because `ticket.export` and `ticket.read.all` are
      // held by the same role; live the first time a custom role grants one
      // without the other, which is the caller `unrestricted` was built for.
      const admin = memberContext(
        { id: tenant.agentId, organizationId: tenant.organizationId },
        ['analytics.read', 'ticket.read.all'],
      );
      const restricted = memberContext(
        { id: tenant.agentId, organizationId: tenant.organizationId },
        ['analytics.read'],
      );

      const wide = await facade.create(
        {
          kind: toProtoExportKind(ExportKind.TICKET),
          from: '2026-03-01',
          to: '2026-03-31',
          filters: '',
        },
        admin,
      );
      const narrow = await facade.create(
        {
          kind: toProtoExportKind(ExportKind.TICKET),
          from: '2026-03-01',
          to: '2026-03-31',
          filters: '',
        },
        restricted,
      );

      expect(narrow.id).not.toBe(wide.id);

      const rows = await fx.prisma.export.findMany({
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((row) => row.unrestricted)).toEqual([true, false]);
    });

    it('**0b. an export belongs to the person who asked for it**', async () => {
      // The other half. Scoping the read closes the escalation; widening the
      // dedupe is what stops a caller being handed an id their own poll would
      // then refuse.
      const mine = await request();
      const somebodyElse = memberContext(
        { id: faker.string.uuid(), organizationId: tenant.organizationId },
        ['analytics.read'],
      );

      await expectRpc(facade.get(mine.id, somebodyElse), status.NOT_FOUND);
    });

    it('0c. a different FILTER set is a different export', async () => {
      // `filters: undefined` in a Prisma `where` means "do not constrain", so
      // an unfiltered request would otherwise match every filtered PENDING row.
      const unfiltered = await facade.create(
        {
          kind: toProtoExportKind(ExportKind.TICKET),
          from: '2026-03-01',
          to: '2026-03-31',
          filters: '',
        },
        caller(),
      );
      const filtered = await facade.create(
        {
          kind: toProtoExportKind(ExportKind.TICKET),
          from: '2026-03-01',
          to: '2026-03-31',
          filters: JSON.stringify({ status: 'OPEN' }),
        },
        caller(),
      );

      expect(filtered.id).not.toBe(unfiltered.id);
      expect(await fx.prisma.export.count()).toBe(2);
    });

    it('**an identical PENDING request returns THAT export, not a second one**', async () => {
      // A double-click otherwise writes two rows, two jobs and two objects —
      // and nothing sweeps exports, so the second is a full copy of tenant data
      // kept forever. `jobId` already makes a duplicated ENQUEUE a no-op; this
      // is the same idea one layer up, where a duplicate costs a file.
      const first = await request();
      const second = await request();

      expect(second.id).toBe(first.id);
      expect(await fx.prisma.export.count()).toBe(1);
    });

    it('2. a DIFFERENT range is a different export', async () => {
      // Matched on the whole request: two ranges are two files.
      const first = await request();
      const second = await request({ to: '2026-04-30' });

      expect(second.id).not.toBe(first.id);
      expect(await fx.prisma.export.count()).toBe(2);
    });

    it('**2b. a range longer than the span cap is refused, before any work**', async () => {
      // The cheap guard. It bounds DAYS while the byte bound counts ROWS, so it
      // guarantees nothing alone — but it refuses the common mistake instantly
      // and names the limit instead of failing an hour later.
      await expectRpc(
        request({ from: '2026-01-01', to: '2026-12-31' }),
        status.INVALID_ARGUMENT,
      );

      expect(await fx.prisma.export.count()).toBe(0);
    });

    it('2c. an INVERTED range is refused too', async () => {
      await expectRpc(
        request({ from: '2026-03-31', to: '2026-03-01' }),
        status.INVALID_ARGUMENT,
      );
    });

    it('2d. exactly the cap is accepted', async () => {
      // 92 days inclusive: 1 January to 2 April.
      await expect(
        request({ from: '2026-01-01', to: '2026-04-02' }),
      ).resolves.toBeDefined();
    });

    it('**3. requesting one is audited, at REQUEST time**', async () => {
      // The act is that a person asked for a copy of tenant data — true whether
      // or not the file ever renders.
      fx.audit.record.mockClear();

      const created = await request();

      const [[, event]] = fx.audit.record.mock.calls as [
        [
          unknown,
          {
            action: string;
            resourceType: string;
            resourceId: string;
            metadata: Record<string, unknown>;
          },
        ],
      ];
      expect(event.action).toBe('DATA_EXPORT_REQUESTED');
      expect(event.resourceType).toBe('EXPORT');
      expect(event.resourceId).toBe(created.id);
      expect(event.metadata).toMatchObject({
        kind: ExportKind.TICKET_DAILY,
      });
    });

    it('4. the audit row carries the RANGE and no filters', async () => {
      // A ticket filter can carry a search term, and an audit trail is not a
      // second copy of tenant prose.
      fx.audit.record.mockClear();

      await request();

      const [[, event]] = fx.audit.record.mock.calls as [
        [unknown, { metadata: Record<string, unknown> }],
      ];
      expect(Object.keys(event.metadata).sort(compareAlphabetically)).toEqual(
        ['fromDay', 'kind', 'toDay'].sort(compareAlphabetically),
      );
    });

    it('5. a de-duplicated request is NOT audited twice', async () => {
      // Nothing new was asked for — the caller was handed the export that
      // already existed.
      await request();
      fx.audit.record.mockClear();

      await request();

      expect(fx.audit.record).not.toHaveBeenCalled();
    });
  });

  describe('the job', () => {
    it('1. Returns a job id IMMEDIATELY; the file appears later', async () => {
      // A synchronous export of a quarter would hold a request open for the
      // length of a bulk read — the hot-path competition this whole design
      // exists to avoid, arriving through the one endpoint that looks like a
      // read.
      await seedRollup();

      const created = await request();

      expect(created.id).toBeTruthy();
      expect(fromProtoExportStatus(created.status)).toBe(ExportStatus.PENDING);
      expect(created.downloadUrl).toBeUndefined();
      // Nothing uploaded yet.
      expect(presignExport).not.toHaveBeenCalled();
    });

    it('2. Produces the file, and the URL appears once it is READY', async () => {
      await seedRollup();
      const created = await request();

      await runWorker(created.id);
      const ready = await facade.get(created.id, caller());

      expect(fromProtoExportStatus(ready.status)).toBe(ExportStatus.READY);
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

      const row = await fx.prisma.export.findUniqueOrThrow({
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
        request({ kind: ProtoExportKind.UNRECOGNIZED }),
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
        kind: toProtoExportKind(ExportKind.AGENT_DAILY),
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

      expect(fromProtoExportStatus(ready.status)).toBe(ExportStatus.READY);
      expect(ready.rowCount).toBe(0);
      expect(csv).toContain('# generated_at=');
      expect(csv).toContain('# rollup_computed_at=none');
    });
  });

  describe('the row exports', () => {
    const ticketExport = (overrides = {}) =>
      facade.create(
        {
          kind: toProtoExportKind(ExportKind.TICKET),
          from: '2026-03-01',
          to: '2026-03-31',
          filters: '',
          ...overrides,
        },
        caller(),
      );

    it('**1. a ticket export contains only what the CALLER can see**', async () => {
      // An export is a read, and a read that ignores the boundary its list
      // respects is the widest possible leak of it. This caller holds
      // `analytics.read` and NOT `ticket.read.all`, so the file is theirs.
      const mine = await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
        authorId: tenant.agentId,
        title: 'Mine',
      });
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-03T09:00:00.000Z'),
        title: 'Somebody elses',
      });

      const created = await ticketExport();
      await runWorker(created.id);

      const [csv] = uploadedBodies;
      expect(csv).toContain(mine.id);
      expect(csv).not.toContain('Somebody elses');
    });

    it('**2. a title containing a comma does not shift the columns**', async () => {
      // Every rollup column is a date or an integer; a ticket title is free
      // text, and one comma would move every field after it.
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
        authorId: tenant.agentId,
        title: 'Login fails, sometimes',
      });

      const created = await ticketExport();
      await runWorker(created.id);

      const [csv] = uploadedBodies;
      expect(csv).toContain('"Login fails, sometimes"');
      expect(csv).toContain('ticket_id,ticket_number,title,');
    });

    it('**3. a range with more rows than the cap FAILS with the count**', async () => {
      // The refusal has to name the number, or "your export failed" is all the
      // caller gets from a limit they could have acted on.
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
        authorId: tenant.agentId,
      });
      jest.spyOn(fx.prisma.ticket, 'count').mockResolvedValueOnce(140_000);

      const created = await ticketExport();
      // **Does NOT reject.** The count is the same on every attempt, so a
      // rethrow would spend the queue's one slot re-counting the same range
      // twice more to reach the answer the caller already has. Tests 11 and 12
      // assert the opposite for storage failures, which is the point.
      await expect(runWorker(created.id)).resolves.toBeUndefined();

      const row = await fx.prisma.export.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.status).toBe(ExportStatus.FAILED);
      expect(row.errorLog).toContain('140,000');
      expect(row.errorLog).toContain('Narrow the range');
    });

    it('4. an audit-log export flattens `metadata` into one quoted cell', async () => {
      // The nested column, and the argument for offering JSON on this export
      // and not on the ticket one.
      await fx.prisma.auditLog.create({
        data: {
          organizationId: tenant.organizationId,
          action: 'USER_ROLES_UPDATED',
          resourceType: 'USER',
          resourceId: tenant.agentId,
          userId: tenant.agentId,
          metadata: { before: ['a'], after: ['a', 'b'] },
          createdAt: at('2026-03-04T09:00:00.000Z'),
        },
      });

      const created = await facade.create(
        {
          kind: toProtoExportKind(ExportKind.AUDIT_LOG),
          from: '2026-03-01',
          to: '2026-03-31',
          filters: '',
        },
        caller(),
      );
      await runWorker(created.id);

      const [csv] = uploadedBodies;
      expect(csv).toContain('USER_ROLES_UPDATED');
      // Quoted, and every inner quote doubled — RFC 4180.
      expect(csv).toContain('""before""');
    });

    it('**8. the range is the TENANT’S month, not the server’s**', async () => {
      // `from_day`/`to_day` are local dates — the same domain the rollups bucket
      // by. Comparing them against UTC midnight exports a different range than
      // the rollup kinds do from the same request: at UTC+7 that is seven hours
      // of July included and seven hours of 31 August dropped.
      jest
        .spyOn(
          fx.moduleRef.get(AuthReferenceService),
          'listOrganizationTimezones',
        )
        .mockResolvedValue(new Map([[tenant.organizationId, 'Asia/Bangkok']]));

      // 17:10 UTC on 31 July is 00:10 on 1 August in Bangkok — INSIDE the
      // tenant's August, outside UTC's.
      const localAugust = await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-07-31T17:10:00.000Z'),
        authorId: tenant.agentId,
        title: 'Local August',
      });
      // 20:00 UTC on 31 August is 03:00 on 1 September in Bangkok — OUTSIDE the
      // tenant's August, inside UTC's.
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-08-31T20:00:00.000Z'),
        authorId: tenant.agentId,
        title: 'Local September',
      });

      const created = await facade.create(
        {
          kind: toProtoExportKind(ExportKind.TICKET),
          from: '2026-08-01',
          to: '2026-08-31',
          filters: '',
        },
        caller(),
      );
      await runWorker(created.id);

      const [csv] = uploadedBodies;
      expect(csv).toContain(localAugust.id);
      expect(csv).not.toContain('Local September');
    });

    it('**5. an unknown filter key is REFUSED, not stored and ignored**', async () => {
      // The JSON column is storage, not a contract. A filter the caller
      // believes applied and that silently did not is the failure this shape is
      // most exposed to.
      await expectRpc(
        ticketExport({ filters: JSON.stringify({ notAKey: 'x' }) }),
        status.INVALID_ARGUMENT,
      );

      expect(await fx.prisma.export.count()).toBe(0);
    });

    it('**9. an unknown filter VALUE is refused, not silently unmatched**', async () => {
      // Keys were already refused; a value one level down produced a READY
      // zero-row export — the same silently-dropped filter, wearing a different
      // shape.
      await expectRpc(
        ticketExport({ filters: JSON.stringify({ status: 'NONSENSE' }) }),
        status.INVALID_ARGUMENT,
      );
    });

    it('10b. the value must be spelled as the enum spells it', async () => {
      // Exact, deliberately: coercing `open` to `OPEN` would reintroduce the
      // silent no-match for every other near-miss.
      await expectRpc(
        ticketExport({ filters: JSON.stringify({ status: 'open' }) }),
        status.INVALID_ARGUMENT,
      );

      await expect(
        ticketExport({ filters: JSON.stringify({ status: 'OPEN' }) }),
      ).resolves.toBeDefined();
    });

    it('10c. an id-shaped filter takes any string', async () => {
      // `assigneeId` names no enum: a wrong id is a legitimately empty result
      // rather than a typo the system can catch.
      await expect(
        ticketExport({
          filters: JSON.stringify({ assigneeId: faker.string.uuid() }),
        }),
      ).resolves.toBeDefined();
    });

    it('6. a filter legal for ANOTHER kind is still refused', async () => {
      // `action` is an audit-log filter. Allowed keys are per kind, not global.
      await expectRpc(
        ticketExport({ filters: JSON.stringify({ action: 'USER_CREATED' }) }),
        status.INVALID_ARGUMENT,
      );
    });

    it('7. the rollup kinds take NO filters at all', async () => {
      await expectRpc(
        request({ filters: JSON.stringify({ status: 'OPEN' }) }),
        status.INVALID_ARGUMENT,
      );
    });
  });

  describe('failure', () => {
    it('11. **Reports failure when PRESIGN is rejected**', async () => {
      // A storage failure, not the empty-file rule — test 10 covers what an
      // empty range does, and it is READY. This one exists for the other half:
      // a failure must reach the poll route with its reason, and must not leave
      // a file behind.
      await seedRollup();
      presignExport.mockRejectedValue(new Error('storage is down'));

      const created = await request();

      await expect(runWorker(created.id)).rejects.toThrow('storage is down');

      const failed = await facade.get(created.id, caller());
      expect(fromProtoExportStatus(failed.status)).toBe(ExportStatus.FAILED);
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
      expect(fromProtoExportStatus(failed.status)).toBe(ExportStatus.FAILED);
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
        fromProtoExportStatus((await facade.get(created.id, caller())).status),
      ).toBe(ExportStatus.FAILED);

      // The retry BullMQ would perform.
      await runWorker(created.id);

      const ready = await facade.get(created.id, caller());
      expect(fromProtoExportStatus(ready.status)).toBe(ExportStatus.READY);
      expect(ready.error).toBeUndefined();
    });
  });
});
