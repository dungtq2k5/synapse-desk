import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { formatErrorMsg } from '@synapsedesk/common';
import { PrismaService } from './prisma.service';

/**
 * Bootstrap DDL for ingestion-service.
 *
 * Like ticket-service's, this seeds no ROWS — Domain C has no reference data.
 * What it applies is the five indexes `schema.prisma` cannot express, and two
 * of them are not optimizations:
 *
 *   - `documents_org_hash_key` is the PER-TENANT dedup rule. A plain
 *     `@@unique([organizationId, fileHash])` would survive a soft delete and
 *     block re-uploading a document you had deleted; the partial index releases
 *     the slot, which is the whole reason it is partial.
 *   - `document_chunks_fts_idx` is the lexical retrieval arm's index, and it is
 *     COMPOSITE for a security-adjacent reason: tenant filtering
 *     must happen BEFORE text matching. A GIN index on the tsvector alone
 *     matches text across every tenant's chunks and filters afterwards — not a
 *     leak, but a query that degrades exactly as the corpus grows.
 *
 * All idempotent (`IF NOT EXISTS`), so running on every boot is safe and so is
 * running concurrently across replicas: `CREATE... IF NOT EXISTS` has no
 * read-then-write race to lose.
 */
@Injectable()
export class DatabaseSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The schema objects, on EVERY boot.
   *
   * **There is no `SEED_ON_BOOTSTRAP` branch here any more, and there never
   * should have been one.** This service seeds no rows — `seed()` is
   * `assertSchemaExists()` plus DDL and nothing else — so the flag gated
   * nothing a person could want to skip while removing partial indexes and
   * CHECK constraints that Prisma cannot express and nothing else creates.
   * Every statement is `IF NOT EXISTS` or equivalent, so running it
   * unconditionally is idempotent by construction, which is why the flag was
   * never load-bearing here.
   */
  async onApplicationBootstrap(): Promise<void> {
    // **The hook ASSERTS; it no longer applies.** ADR 0043 moved the schema
    // objects to the deploy step — `prisma migrate deploy` then
    // `src/schema-apply.ts`, both in the init container, both before this pod
    // is in the endpoint list. `CREATE INDEX` takes a `ShareLock` even when
    // `IF NOT EXISTS` makes it a no-op, and that lock queues behind any open
    // write transaction; on the boot path that wait sat in front of readiness.
    //
    // The check STAYS, and that is the load-bearing half: ADR 0042's finding
    // was a schema step that could be skipped without anything noticing, and
    // a boot path that fell silent along with the step would recreate it. A
    // service started outside Kubernetes gets no init container, so this is
    // the only thing between it and serving against an unmigrated database.
    await this.assertSchemaExists();
  }

  /**
   * Both halves — which here is one half: this service seeds no rows.
   *
   * **Kept deliberately, and not because five call sites would need editing.**
   * `seed()` means "put this database into the state a service expects", and
   * that sentence stays true the day this service grows rows;
   * `applySchemaObjects()` would not, and a fixture calling the narrower name
   * would keep compiling, keep passing, and silently stop applying them — the
   * same shape as the flag this phase removed, arriving through a rename.
   *
   * **The hook calls this same method for the reason `.env.test` turns the
   * hook off:** two seeding paths where one only sometimes runs is worse than
   * one. Inlining `applySchemaObjects()` into the hook while the fixtures call
   * `seed()` would recreate exactly that split. The chain is two levels here,
   * not three, and it exists so both callers reach the same code.
   */
  async seed(): Promise<void> {
    await this.applySchemaObjects();
  }

  /**
   * Everything Prisma cannot express, plus the check that the schema is there
   * at all. One name across all four services, so ADR 0039 and
   * `development-conventions.md` §7 can point at a method that exists.
   */
  async applySchemaObjects(): Promise<void> {
    await this.assertSchemaExists();

    try {
      await this.applyIndexes();
      this.logger.log('ingestion-service schema seed complete');
    } catch (error) {
      this.logger.error(`Schema seed failed: ${formatErrorMsg(error)}`);
      throw error;
    }
  }

  /**
   * Every table this service cannot start without — COUNTED, not probed.
   *
   * A single probe answers "is the database empty", and that is not the only
   * way a schema arrives incomplete: `prisma db push` interrupted partway
   * leaves `documents` present and the rest missing, which reads as success. The
   * expected set is small on purpose — the tables the seeder and the boot path
   * touch — because this is a smoke check, not a schema diff.
   */
  async assertSchemaExists(): Promise<void> {
    const expected = ['documents', 'document_chunks', 'ingestion_jobs'];

    const rows = await this.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${expected})
    `;

    const missing = expected.filter(
      (table) => !rows.some((row) => row.table_name === table),
    );

    if (missing.length) {
      throw new Error(
        `The database is missing ${missing.length} expected table(s): ` +
          `${missing.join(', ')}. Nothing has been pushed to it, or a push ` +
          'was interrupted. Run `npm run db:push` (dev) or ' +
          '`npm run db:test:push` (test) and start again.',
      );
    }
  }

  /**
   * The indexes and constraints Prisma cannot express.
   *
   * This block IS the list — see `development-conventions.md` §7. Nothing here
   * is enumerated anywhere else, because an enumeration kept in prose goes
   * stale silently and a `CREATE ... IF NOT EXISTS` cannot.
   *
   * `pg_trgm` is deliberately absent: the lexical arm is full-text search, not
   * fuzzy matching, and adding an extension nothing queries would be one more
   * thing that has to exist in every environment.
   */
  private async applyIndexes(): Promise<void> {
    // Per-tenant dedup. Two tenants uploading the same public PDF are two
    // documents — global dedup would leak the existence of one tenant's upload
    // to another, which is the kind of leak nobody looks for.
    //
    // `WHERE deleted_at IS NULL` so a soft delete releases the slot. Restoring
    // into a hash somebody else has since taken is then a P2002 the service
    // catches and names, exactly as Domain A's user restore does.
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "documents_org_hash_key"
        ON "documents" ("organization_id", "file_hash")
        WHERE "deleted_at" IS NULL;
    `);

    // The lexical retrieval arm's index — COMPOSITE, not a bare tsvector GIN.
    //
    // `'simple'` and not `'english'`: the corpus is multilingual because the
    // embedding model is, and the english dictionary stems and stop-words
    // non-English text into nonsense. Per-tenant language configuration is a
    // later decision, and only if a tenant demonstrably needs stemming.
    //
    // btree_gin is what lets a GIN index carry the plain `organization_id`
    // alongside the tsvector; without the extension Postgres rejects the mixed
    // operator classes.
    await this.prisma.$executeRawUnsafe(
      `CREATE EXTENSION IF NOT EXISTS btree_gin;`,
    );
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "document_chunks_fts_idx"
        ON "document_chunks"
        USING GIN ("organization_id", to_tsvector('simple', "content_text"));
    `);

    // `department_ids` is queried with && (array overlap) on every retrieval.
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "document_chunks_dept_idx"
        ON "document_chunks" USING GIN ("department_ids");
    `);

    // The daily chunk-usage projection is an array-containment scan over the
    // largest table in the system. Without these it is a sequential scan, and
    // the job that keeps Table 19's counters honest becomes the slowest thing
    // running.
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ai_generations_retrieved_idx"
        ON "ai_generations" USING GIN ("retrieved_chunk_ids");
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ai_generations_cited_idx"
        ON "ai_generations" USING GIN ("cited_chunk_ids");
    `);

    // At most one LIVE ingestion job per document.
    //
    // `superseded_by_id` closes the double-click on ONE row and leaves the
    // per-document case open: two clicks on two different terminal rows of the
    // same document both succeed, and so does any second re-enqueue path.
    // Retry, reindex and replace are three such paths, which is the point at
    // which one database rule beats three service-layer guards.
    //
    // The predicate lists the RUNNING statuses rather than negating the
    // terminal ones: a status added later is excluded until someone decides it
    // belongs here, and the failure mode of that default is a permitted
    // duplicate rather than a document nothing can ever re-run.
    await this.prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ingestion_jobs_one_live_per_document"
        ON "ingestion_jobs" ("document_id")
        WHERE "status" IN ('QUEUED', 'PARSING', 'CHUNKING', 'EMBEDDING');
    `);
  }
}
