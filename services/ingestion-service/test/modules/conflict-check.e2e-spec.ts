import { faker } from '@faker-js/faker';
import {
  AtCapAction,
  CONFLICT_CONFIDENCE_MIN,
  CONFLICT_SWEEP_PER_TENANT,
  DocumentFlagResolution,
  DocumentFlagSeverity,
  DocumentFlagType,
  DocumentStatus,
  DOCUMENT_PATTERNS,
} from '@synapsedesk/contracts';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import {
  buildTenant,
  createDocument,
  createScopedDocument,
  TenantFixture,
} from '../factories';
import { AiLedgerService } from '../../src/modules/ai-ledger/ai-ledger.service';
import { ConflictCheckService } from '../../src/modules/ingestion/conflict-check.service';
import { UNREADABLE_CONFLICT_DETAIL } from '../../src/modules/scheduled/document-flag-writer';
import { ConflictCheckQueueService } from '../../src/modules/ingestion/conflict-check-queue.service';
import { ScopeFanoutProcessor } from '../../src/modules/ingestion/scope-fanout.processor';
import { QdrantService } from '../../src/modules/qdrant/qdrant.service';
import { RagReferenceService } from '../../src/modules/rag-client/rag-reference.service';
import { LedgerDailySequence } from '../../src/modules/scheduler/ledger-daily.sequence';

/**
 * `CONFLICTING`: a document's passages against the nearest passages of the
 * other documents in its tenant, judged by rag-service.
 *
 * The nearest-neighbour read and the judge are faked in most rows, so each
 * row says which pairs exist and what the judge decides. One row runs the
 * real Qdrant read.
 */
describe('The conflict check (e2e)', () => {
  let fx: E2eFixture;
  let conflicts: ConflictCheckService;
  let qdrant: QdrantService;
  let tenant: TenantFixture;

  let nearest: jest.SpyInstance;
  let judge: jest.SpyInstance;
  let budget: jest.SpyInstance;

  /** The pairs Qdrant answers, by chunk: chunk id → other chunks. */
  let neighbours: Map<string, { chunkId: string; documentId: string }[]>;
  /** The judge's verdict, by the other passage's text. */
  let verdicts: Map<string, { confidence: number; detail: string }>;

  /** An INDEXED document with one live, embedded passage. */
  const documentWith = async (
    text: string,
    scope: { departmentIds?: string[]; deleted?: boolean } = {},
  ) => {
    const overrides = {
      status: DocumentStatus.INDEXED,
      title: `${text.slice(0, 20)}…`,
      ...(scope.deleted ? { deletedAt: new Date() } : {}),
    };
    const document = scope.departmentIds
      ? await createScopedDocument(
          fx.prisma,
          tenant,
          scope.departmentIds,
          overrides,
        )
      : await createDocument(fx.prisma, tenant, overrides);
    const chunk = await fx.prisma.documentChunk.create({
      data: {
        documentId: document.id,
        chunkIndex: 0,
        contentText: text,
        tokenCount: 10,
        vectorPointId: faker.string.uuid(),
        organizationId: tenant.organizationId,
        isOrganizationWide: document.isOrganizationWide,
        departmentIds: scope.departmentIds ?? [],
      },
    });

    return { ...document, chunkId: chunk.id };
  };

  /** Makes `b` a near neighbour of `a`, and the judge's answer about it. */
  const pair = (
    a: { chunkId: string },
    b: { id: string; chunkId: string },
    otherText: string,
    confidence = 0.9,
  ) => {
    neighbours.set(a.chunkId, [
      ...(neighbours.get(a.chunkId) ?? []),
      { chunkId: b.chunkId, documentId: b.id },
    ]);
    verdicts.set(otherText, {
      confidence,
      detail: `This says one thing; ${otherText} says another.`,
    });
  };

  const openConflicts = () =>
    fx.prisma.documentFlag.findMany({
      where: {
        organizationId: tenant.organizationId,
        flagType: DocumentFlagType.CONFLICTING,
        resolvedAt: null,
      },
      orderBy: { detectedAt: 'asc' },
    });

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    conflicts = fx.moduleRef.get(ConflictCheckService);
    qdrant = fx.moduleRef.get(QdrantService);
    nearest = jest.spyOn(qdrant, 'nearestInOtherDocuments');
    judge = jest.spyOn(fx.moduleRef.get(RagReferenceService), 'judgeConflict');
    budget = jest.spyOn(fx.moduleRef.get(AiLedgerService), 'checkBudget');
  });

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();
    neighbours = new Map();
    verdicts = new Map();

    nearest.mockReset().mockImplementation(async (vectorPointId: string) => {
      const chunk = await fx.prisma.documentChunk.findFirst({
        where: { vectorPointId },
      });
      return (neighbours.get(chunk?.id ?? '') ?? []).map((hit) => ({
        ...hit,
        score: 0.95,
      }));
    });
    judge
      .mockReset()
      .mockImplementation(
        (_org: string, _first: unknown, second: { text: string }) => {
          const verdict = verdicts.get(second.text);
          return Promise.resolve(
            verdict
              ? { conflicting: true, ...verdict }
              : { conflicting: false, confidence: 0, detail: '' },
          );
        },
      );
    budget
      .mockReset()
      .mockResolvedValue({ allowed: true, action: AtCapAction.DEFER });
  });

  afterAll(() => fx.close());

  it('**raises a conflict on the side whose readers can open the other: HR’s policy, not the handbook**', async () => {
    const handbook = await documentWith('Carryover is 10 days.');
    const hrPolicy = await documentWith('Carryover is 5 days.', {
      departmentIds: [tenant.departmentId],
    });
    pair(handbook, hrPolicy, 'Carryover is 5 days.');

    await expect(conflicts.check(handbook.id)).resolves.toBe(true);

    const flags = await openConflicts();
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      documentId: hrPolicy.id,
      relatedDocumentId: handbook.id,
      relatedChunkId: hrPolicy.chunkId,
      severity: DocumentFlagSeverity.CRITICAL,
      confidenceScore: 0.9,
      detail: 'This says one thing; Carryover is 5 days. says another.',
    });
    const checked = await fx.prisma.document.findUniqueOrThrow({
      where: { id: handbook.id },
    });
    expect(checked.conflictsCheckedAt).not.toBeNull();
  });

  it('raises on both sides when each side’s readers can open the other', async () => {
    const a = await documentWith('Expenses are paid monthly.');
    const b = await documentWith('Expenses are paid weekly.');
    pair(a, b, 'Expenses are paid weekly.');

    await conflicts.check(a.id);

    const flags = await openConflicts();
    expect(
      flags.map((flag) => [flag.documentId, flag.relatedDocumentId]).sort(),
    ).toEqual(
      [
        [a.id, b.id],
        [b.id, a.id],
      ].sort(),
    );
  });

  it('raises nothing when neither side’s readers can open the other', async () => {
    const hr = await documentWith('HR says 5.', {
      departmentIds: [tenant.departmentId],
    });
    const it_ = await documentWith('IT says 10.', {
      departmentIds: [tenant.otherDepartmentId],
    });
    pair(hr, it_, 'IT says 10.');

    await expect(conflicts.check(hr.id)).resolves.toBe(true);

    expect(await openConflicts()).toEqual([]);
  });

  it('**gives a document one flag per document it conflicts with**', async () => {
    const a = await documentWith('Remote work is 2 days.');
    const b = await documentWith('Remote work is 3 days.');
    const c = await documentWith('Remote work is 4 days.');
    pair(a, b, 'Remote work is 3 days.');
    pair(a, c, 'Remote work is 4 days.');

    await conflicts.check(a.id);

    const onA = (await openConflicts()).filter(
      (flag) => flag.documentId === a.id,
    );
    expect(onA.map((flag) => flag.relatedDocumentId).sort()).toEqual(
      [b.id, c.id].sort(),
    );
  });

  it('raises nothing under the confidence threshold', async () => {
    const a = await documentWith('Laptops are returned in 7 days.');
    const b = await documentWith('Laptops are returned in 14 days.');
    pair(
      a,
      b,
      'Laptops are returned in 14 days.',
      CONFLICT_CONFIDENCE_MIN - 0.01,
    );

    await conflicts.check(a.id);

    expect(await openConflicts()).toEqual([]);
  });

  it('**a re-check that no longer finds the conflict resolves both sides**', async () => {
    const a = await documentWith('Parking is free.');
    const b = await documentWith('Parking costs 5 a day.');
    pair(a, b, 'Parking costs 5 a day.');
    await conflicts.check(a.id);
    expect(await openConflicts()).toHaveLength(2);

    // The judge now says they agree (A was rewritten).
    verdicts.clear();
    await expect(conflicts.check(a.id)).resolves.toBe(true);

    expect(await openConflicts()).toEqual([]);
    // B3 still holds, so the resolved flags keep the judge's sentence.
    const resolved = await fx.prisma.documentFlag.findMany({
      where: { flagType: DocumentFlagType.CONFLICTING },
    });
    expect(resolved.map((flag) => flag.detail)).toEqual([
      'This says one thing; Parking costs 5 a day. says another.',
      'This says one thing; Parking costs 5 a day. says another.',
    ]);
    expect(resolved.every((flag) => flag.relatedDocumentId !== null)).toBe(
      true,
    );
  });

  it('a re-check where the passages are no longer similar resolves too', async () => {
    const a = await documentWith('Badges are blue.');
    const b = await documentWith('Badges are red.');
    pair(a, b, 'Badges are red.');
    await conflicts.check(a.id);

    neighbours.clear();
    await conflicts.check(a.id);

    expect(await openConflicts()).toEqual([]);
  });

  it('**at the AI cap the check stops: nothing raised or resolved, the document stays unchecked**', async () => {
    const a = await documentWith('Shifts are 8 hours.');
    const b = await documentWith('Shifts are 12 hours.');
    pair(a, b, 'Shifts are 12 hours.');
    await conflicts.check(a.id);
    await fx.prisma.document.update({
      where: { id: a.id },
      data: { conflictsCheckedAt: null },
    });
    verdicts.clear();
    budget.mockResolvedValue({ allowed: false, action: AtCapAction.DEFER });

    await expect(conflicts.check(a.id)).resolves.toBe(false);

    expect(judge).toHaveBeenCalledTimes(1); // the first check's only call
    expect(await openConflicts()).toHaveLength(2);
    const unchecked = await fx.prisma.document.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(unchecked.conflictsCheckedAt).toBeNull();
    expect(budget).toHaveBeenLastCalledWith(
      tenant.organizationId,
      'DOCUMENT_CONFLICT_CHECK',
      expect.anything(),
    );
  });

  it('a judge failure stops the check the same way, and never throws', async () => {
    const a = await documentWith('Visitors sign in.');
    const b = await documentWith('Visitors need no sign-in.');
    pair(a, b, 'Visitors need no sign-in.');
    judge.mockRejectedValue(new Error('rag-service unavailable'));

    await expect(conflicts.check(a.id)).resolves.toBe(false);

    expect(await openConflicts()).toEqual([]);
    const unchecked = await fx.prisma.document.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(unchecked.conflictsCheckedAt).toBeNull();
  });

  describe('B3 again, after a visibility change', () => {
    /** Every CONFLICTING row, open or resolved. */
    const allConflicts = () =>
      fx.prisma.documentFlag.findMany({
        where: {
          organizationId: tenant.organizationId,
          flagType: DocumentFlagType.CONFLICTING,
        },
      });

    /** A resolved flag that no longer names, links to or quotes the other side. */
    const expectRedacted = async () => {
      const [flag] = await allConflicts();
      expect(flag).toMatchObject({
        detail: UNREADABLE_CONFLICT_DETAIL,
        relatedDocumentId: null,
        relatedChunkId: null,
        confidenceScore: null,
      });
      expect(flag.resolvedAt).not.toBeNull();
      return flag;
    };

    /** A flag on HR's policy naming the org-wide handbook. */
    const raised = async () => {
      const handbook = await documentWith('Carryover is 10 days.');
      const hrPolicy = await documentWith('Carryover is 5 days.', {
        departmentIds: [tenant.departmentId],
      });
      pair(handbook, hrPolicy, 'Carryover is 5 days.');
      await conflicts.check(handbook.id);
      expect(await openConflicts()).toHaveLength(1);
      return { handbook, hrPolicy };
    };

    it('**narrowing the named document resolves the flag**', async () => {
      const { handbook } = await raised();
      await fx.prisma.document.update({
        where: { id: handbook.id },
        data: {
          isOrganizationWide: false,
          departmentLinks: {
            create: { departmentId: tenant.otherDepartmentId },
          },
        },
      });

      await expect(conflicts.retestAudience(handbook.id)).resolves.toBe(1);

      expect(await openConflicts()).toEqual([]);
      await expectRedacted();
    });

    it('**a flag a person already dismissed loses the other side’s words too, and keeps their resolution**', async () => {
      const { handbook } = await raised();
      const [open] = await openConflicts();
      await fx.prisma.documentFlag.update({
        where: { id: open.id },
        data: {
          resolvedAt: new Date(),
          resolvedById: tenant.userId,
          resolution: DocumentFlagResolution.DISMISSED,
          resolutionComment: 'Both are right for their own audience.',
        },
      });
      await fx.prisma.document.update({
        where: { id: handbook.id },
        data: {
          isOrganizationWide: false,
          departmentLinks: {
            create: { departmentId: tenant.otherDepartmentId },
          },
        },
      });

      await expect(conflicts.retestAudience(handbook.id)).resolves.toBe(1);

      const flag = await expectRedacted();
      expect(flag).toMatchObject({
        resolution: DocumentFlagResolution.DISMISSED,
        resolvedById: tenant.userId,
        resolutionComment: 'Both are right for their own audience.',
      });
    });

    it('**widening the flagged document resolves the flag**', async () => {
      // HR's policy names a document HR and IT can both open; once the policy
      // is org-wide, its readers include people who can open neither.
      const hrPolicy = await documentWith('Carryover is 5 days.', {
        departmentIds: [tenant.departmentId],
      });
      const shared = await documentWith('Carryover is 10 days.', {
        departmentIds: [tenant.departmentId, tenant.otherDepartmentId],
      });
      pair(hrPolicy, shared, 'Carryover is 10 days.');
      await conflicts.check(hrPolicy.id);
      expect((await openConflicts()).map((flag) => flag.documentId)).toEqual([
        hrPolicy.id,
      ]);
      await fx.prisma.document.update({
        where: { id: hrPolicy.id },
        data: { isOrganizationWide: true, departmentLinks: { deleteMany: {} } },
      });

      await expect(conflicts.retestAudience(hrPolicy.id)).resolves.toBe(1);

      expect(await openConflicts()).toEqual([]);
      await expectRedacted();
    });

    it('deleting the named document resolves the flag, through the fan-out job', async () => {
      const { handbook } = await raised();
      await fx.prisma.document.update({
        where: { id: handbook.id },
        data: { deletedAt: new Date() },
      });

      await fx.moduleRef.get(ScopeFanoutProcessor).process({
        name: 'reconcile-scope',
        data: {
          pattern: DOCUMENT_PATTERNS.scopeChanged,
          organizationId: tenant.organizationId,
          documentId: handbook.id,
          occurredAt: new Date().toISOString(),
          restricting: true,
        },
      } as never);

      expect(await openConflicts()).toEqual([]);
      await expectRedacted();
    });
  });

  it('**the nightly sweep queues at most its cap per tenant, the oldest unchecked first**', async () => {
    const enqueue = jest
      .spyOn(fx.moduleRef.get(ConflictCheckQueueService), 'enqueue')
      .mockResolvedValue();
    const busy = tenant;
    const oldest = await createDocument(fx.prisma, busy, {
      status: DocumentStatus.INDEXED,
      createdAt: new Date('2025-01-01T00:00:00Z'),
    });
    for (let index = 0; index < CONFLICT_SWEEP_PER_TENANT; index += 1) {
      await createDocument(fx.prisma, busy, { status: DocumentStatus.INDEXED });
    }
    await createDocument(fx.prisma, busy, {
      status: DocumentStatus.INDEXED,
      conflictsCheckedAt: new Date(),
    });
    await createDocument(fx.prisma, busy, {
      status: DocumentStatus.PROCESSING,
    });
    const quiet = buildTenant();
    await createDocument(fx.prisma, quiet, { status: DocumentStatus.INDEXED });

    await fx.moduleRef.get(LedgerDailySequence).run({ seedCursor: false });

    const queued = enqueue.mock.calls.map(([id]) => id);
    const documents = await fx.prisma.document.findMany({
      where: { id: { in: queued } },
      select: { organizationId: true },
    });
    expect(
      documents.filter((d) => d.organizationId === busy.organizationId),
    ).toHaveLength(CONFLICT_SWEEP_PER_TENANT);
    expect(
      documents.filter((d) => d.organizationId === quiet.organizationId),
    ).toHaveLength(1);
    expect(queued).toContain(oldest.id);
    enqueue.mockRestore();
  });

  it('the nearest read returns other documents’ live passages only', async () => {
    nearest.mockRestore();
    const vector = Array.from({ length: 768 }, () => 0.1);
    const point = (documentId: string, overrides = {}) => ({
      vectorPointId: faker.string.uuid(),
      vector,
      chunkId: faker.string.uuid(),
      documentId,
      organizationId: tenant.organizationId,
      isOrganizationWide: true,
      departmentIds: [],
      isDeleted: false,
      ...overrides,
    });
    const own = faker.string.uuid();
    const other = faker.string.uuid();
    const deleted = faker.string.uuid();
    const staged = faker.string.uuid();
    const mine = point(own);
    const theirs = point(other);
    await qdrant.upsertChunks([
      mine,
      point(own),
      theirs,
      point(deleted, { isDeleted: true }),
      point(staged),
    ]);
    // Written staged; make all but `staged` live, as a swap does.
    for (const documentId of [own, other, deleted]) {
      await qdrant.swapDocumentPoints(documentId, tenant.organizationId, {
        isOrganizationWide: true,
        departmentIds: [],
        isDeleted: documentId === deleted,
      });
    }
    await qdrant.upsertChunks([
      point(faker.string.uuid(), {
        organizationId: buildTenant().organizationId,
      }),
    ]);

    const hits = await qdrant.nearestInOtherDocuments(
      mine.vectorPointId,
      own,
      tenant.organizationId,
      10,
      0.5,
    );

    expect(hits.map((hit) => hit.chunkId)).toEqual([theirs.chunkId]);
    expect(hits[0].documentId).toBe(other);

    for (const documentId of [own, other, deleted, staged]) {
      await qdrant.deleteDocumentPoints(documentId, tenant.organizationId);
    }
    nearest = jest.spyOn(qdrant, 'nearestInOtherDocuments');
  });
});
