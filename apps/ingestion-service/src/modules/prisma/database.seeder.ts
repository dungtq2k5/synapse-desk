import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.configService.getOrThrow<boolean>('SEED_ON_BOOTSTRAP')) {
      this.logger.log('SEED_ON_BOOTSTRAP is false — skipping schema seed');
      return;
    }

    await this.seed();
  }

  async seed(): Promise<void> {
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
   * Fail with an ACTIONABLE message when the database has no schema at all.
   *
   * Without this the first statement of the seed is a raw `CREATE INDEX... ON
   * documents`, so an unpushed database reports `relation "documents" does not
   * exist` from inside a helper — a symptom that reads like a seeder bug and
   * takes a stack trace to trace back to the real cause, which is simply that
   * nothing ever pushed the schema here.
   *
   * The e2e suites cannot hit it and neither can a long-running environment, so
   * the only people who ever see it are on a fresh clone or a fresh Docker
   * volume — exactly the audience least able to interpret it. Ported from
   * auth-service, which already had this guard and was therefore the ONE
   * service that said what to do when a `docker compose down -v` wiped the
   * volumes.
   */
  private async assertSchemaExists(): Promise<void> {
    const [{ present }] = await this.prisma.$queryRaw<[{ present: boolean }]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'documents'
      ) AS present
    `;

    if (!present) {
      throw new Error(
        'The database has no schema — nothing has been pushed to it yet. ' +
          'Run `npm run db:push` (dev) or `npm run db:test:push` (test) and start again.',
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
