import { bootstrapE2eTest, E2eFixture } from '../utils';

type IndexRow = { indexname: string };
type ConstraintRow = { count: bigint };

/**
 * -2 — the service boots, and every index the seeder promises
 * actually exists.
 *
 * The index assertions are not ceremony. Two of these five are load-bearing:
 * without `documents_org_hash_key` every "duplicate rejected" test passes on
 * the service-layer check alone and the database would happily accept a second
 * row; without `document_chunks_fts_idx` the lexical retrieval arm still
 * returns correct answers, just slower and slower as the corpus grows — which
 * is invisible until a query that took 20 ms takes 20 s.
 */
describe('Ingestion-service foundations (e2e)', () => {
  let fx: E2eFixture;

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  });

  beforeEach(() => fx.reset());
  afterAll(() => fx.close());

  const indexesOn = async (table: string): Promise<string[]> => {
    const rows = await fx.prisma.$queryRawUnsafe<IndexRow[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = $1`,
      table,
    );
    return rows.map((row) => row.indexname);
  };

  it('1. boots with every module wired', () => {
    expect(fx.moduleRef).toBeDefined();
    expect(fx.prisma).toBeDefined();
  });

  it('2. has the PER-TENANT dedup index, and it is PARTIAL', async () => {
    // Partial is the whole design. A plain unique constraint would survive a
    // soft delete and permanently block re-uploading a document you had
    // deleted; `WHERE deleted_at IS NULL` releases the slot, which is what
    // makes restore-into-a-taken-slot a real (and handled) 409 rather than an
    // impossible state.
    expect(await indexesOn('documents')).toContain('documents_org_hash_key');

    const [{ count }] = await fx.prisma.$queryRawUnsafe<ConstraintRow[]>(`
      SELECT count(*) FROM pg_indexes
      WHERE indexname = 'documents_org_hash_key'
        AND indexdef ILIKE '%WHERE (deleted_at IS NULL)%'
    `);
    expect(Number(count)).toBe(1);
  });

  it('3. has the COMPOSITE FTS index, not a bare tsvector GIN', async () => {
    // Composite so tenant filtering happens BEFORE text matching.
    // A GIN on the tsvector alone matches text across every tenant's chunks and
    // filters afterwards — correct, but it degrades exactly as the corpus
    // grows, which is the worst time to discover it.
    expect(await indexesOn('document_chunks')).toContain(
      'document_chunks_fts_idx',
    );

    const [{ count }] = await fx.prisma.$queryRawUnsafe<ConstraintRow[]>(`
      SELECT count(*) FROM pg_indexes
      WHERE indexname = 'document_chunks_fts_idx'
        AND indexdef ILIKE '%organization_id%'
        AND indexdef ILIKE '%to_tsvector%'
    `);
    expect(Number(count)).toBe(1);
  });

  it("4. indexes the FTS with 'simple', never 'english'", async () => {
    // The corpus is multilingual because the embedding model is, and the
    // english dictionary stems and stop-words non-English text into nonsense.
    const [{ count }] = await fx.prisma.$queryRawUnsafe<ConstraintRow[]>(`
      SELECT count(*) FROM pg_indexes
      WHERE indexname = 'document_chunks_fts_idx'
        AND indexdef ILIKE '%''simple''%'
    `);
    expect(Number(count)).toBe(1);
  });

  it('5. has the GIN index department_ids is queried with && through', async () => {
    expect(await indexesOn('document_chunks')).toContain(
      'document_chunks_dept_idx',
    );
  });

  it('6. has BOTH ledger GIN indexes the usage projection scans', async () => {
    // The daily projection is an array-containment scan over the largest table
    // in the system. Without these it is a sequential scan, and the job that
    // keeps the usage counters honest becomes the slowest thing running.
    const indexes = await indexesOn('ai_generations');

    expect(indexes).toContain('ai_generations_retrieved_idx');
    expect(indexes).toContain('ai_generations_cited_idx');
  });

  it('7. seeds NO rows — Domain C has no reference data', async () => {
    // Stated as a test so a future contributor adding row seeding has to
    // notice. auth-service seeds a permission catalogue and a system actor;
    // this service has neither, and `reset()`'s unconditional TRUNCATE depends
    // on that staying true.
    const counts = await Promise.all([
      fx.prisma.document.count(),
      fx.prisma.documentChunk.count(),
      fx.prisma.aiGeneration.count(),
      fx.prisma.documentFlag.count(),
    ]);

    expect(counts).toEqual([0, 0, 0, 0]);
  });

  it('8. is idempotent — seeding twice is safe', async () => {
    // Every statement is `IF NOT EXISTS`, which is also what makes it safe to
    // run concurrently across replicas: there is no read-then-write race to
    // lose, unlike auth-service's row seeding.
    const seeder = fx.moduleRef.get(
      (await import('../../src/modules/prisma/database.seeder')).DatabaseSeeder,
    );

    await expect(seeder.seed()).resolves.toBeUndefined();
    expect(await indexesOn('documents')).toContain('documents_org_hash_key');
  });
});
