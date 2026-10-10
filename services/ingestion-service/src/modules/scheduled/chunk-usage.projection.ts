import { Injectable, Logger } from '@nestjs/common';
import {
  PROJECTION_BACKFILL_WINDOW_DAYS,
  PROJECTION_RESET_BATCH,
  PROJECTION_TRANSACTION_TIMEOUT_MS,
} from '@synapsedesk/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The step name this projection runs under, and the key of its cursor row.
 *
 * One string for both, so the `job_runs` heartbeat and the `projection_cursors`
 * row for the same step can be joined by eye when somebody is working out why a
 * number stopped moving.
 */
const CURSOR = 'chunk-usage-projection';

/** Thrown by {@link ChunkUsageProjection.project} when no cursor row exists. */
export class ProjectionCursorMissingError extends Error {
  constructor() {
    super(
      `No '${CURSOR}' row in projection_cursors. The nightly projection reads ` +
        'its lower bound from that row and will not invent one; run the ' +
        'backfill (`npm run projection:backfill -w @synapsedesk/ingestion-service`) once.',
    );
  }
}

/**
 * Rolls the ledger's chunk arrays into `document_chunks` counters.
 *
 * **A projection rather than a query, because of retention.** Retention rolls
 * the ledger into daily per-(org, purpose, model) aggregates that **do not
 * carry the chunk arrays**, so a flag defined against them stops working the
 * moment rollups ship — silently, reporting zero findings, which reads exactly
 * like a healthy corpus.
 *
 * **Ordering constraint: projection BEFORE retention over the same rows.**
 * Reversed, retention deletes rows the projection has not read, and the
 * counters under-report forever with nothing to recompute them from.
 *
 * **Cursor-driven, and the counters are why.** These statements ADD
 * (`retrieval_count + usage.hits`) rather than replacing a row, so any interval
 * that overlaps its predecessor counts the same generation twice. The cursor is
 * the previous interval's exclusive upper bound, which makes consecutive runs
 * abut by construction — no caller can make them overlap.
 *
 * The sibling step, `AiGenerationRollupJob`, gets the same re-run safety from
 * the opposite mechanism: it deletes and re-inserts, so recomputing an interval
 * is free.
 *
 * **Two entry points, and the split is about locks.** {@link project} is the
 * nightly one and is small: one interval, one transaction. {@link backfill} is
 * the one-shot that seeds the cursor, and it is the only thing that resets
 * counters — a full-table reset row-locks every chunk against the uploads
 * `writeChunkRows` is making, so it runs in bounded batches under an operator's
 * hand rather than inside a scheduled job.
 *
 * See `docs/decisions/0025-chunk-usage-is-a-projection.md`.
 */
@Injectable()
export class ChunkUsageProjection {
  private readonly logger = new Logger(ChunkUsageProjection.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Projects every generation in `[cursor, until)`, then advances the cursor.
   *
   * `until` is the caller's and must LAG `now` — see `PROJECTION_LAG_MS`.
   *
   * **The cursor is written in the same transaction as the counters.** A cursor
   * that can disagree with the counters it guards is not a cursor:
   * `job_runs.last_succeeded_at` is a finish time stamped after the fact and
   * outside this transaction, which is why it cannot serve.
   *
   * **Refuses when there is no cursor**, rather than treating its absence as
   * `EPOCH`. Improvising a lower bound would make a scheduled job reset and
   * re-derive the whole corpus inside one transaction, holding a full-table
   * lock on `document_chunks` while uploads wait on it. {@link backfill} is
   * where that work belongs.
   *
   * @throws {ProjectionCursorMissingError} when the cursor row is absent.
   */
  async project(until: Date): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const cursor = await tx.projectionCursor.findUnique({
          where: { name: CURSOR },
        });

        if (!cursor) throw new ProjectionCursorMissingError();

        const rows = await this.projectInterval(tx, cursor.until, until);

        await tx.projectionCursor.update({
          where: { name: CURSOR },
          data: { until },
        });

        this.logger.log(
          `Projected usage onto ${rows.retrieved} retrieved and ${rows.cited} cited chunk row(s)`,
        );

        return rows.retrieved + rows.cited;
      },
      { timeout: PROJECTION_TRANSACTION_TIMEOUT_MS },
    );
  }

  /**
   * Seeds the cursor and derives the counters from the whole ledger.
   *
   * **Run once per database, by hand.** It is the entry point behind
   * `npm run projection:backfill`, and {@link project} refuses until it has
   * been.
   *
   * Three properties worth stating, because each is a thing the nightly path
   * deliberately does not do:
   *
   *   - **It resets, and only it resets.** A counter with no cursor behind it
   *     has nothing recording what produced it, so it is not a base to add to.
   *     The reset runs in batches of {@link PROJECTION_RESET_BATCH} in separate
   *     transactions, so the row locks it takes on `document_chunks` are
   *     bounded rather than corpus-sized.
   *   - **It advances the cursor per window**, inside that window's own
   *     transaction. An interrupted backfill therefore RESUMES: re-running it
   *     finds a cursor, skips the reset, and continues from where it stopped.
   *   - **It is idempotent once complete.** A second run finds the cursor at
   *     `until` and projects an empty interval.
   *
   * `last_retrieved_at` / `last_cited_at` are left alone by the reset, which
   * matches what a re-index already does to them.
   */
  async backfill(until: Date): Promise<number> {
    const existing = await this.prisma.projectionCursor.findUnique({
      where: { name: CURSOR },
    });

    if (!existing) {
      const zeroed = await this.resetCounters();

      this.logger.log(`Reset ${zeroed} chunk counter(s)`);

      // **The oldest generation, not the epoch.** The windows below step
      // forward by a fixed span, so a lower bound of 1970 would be thousands of
      // empty transactions before reaching any data. `null` means the ledger is
      // empty and there is nothing to project, so the cursor starts at the top.
      const [oldest] = await this.prisma.aiGeneration.findMany({
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
      });

      await this.prisma.projectionCursor.create({
        data: { name: CURSOR, until: oldest?.createdAt ?? until },
      });
    }

    let projected = 0;

    // Half-open, disjoint windows, so adding across them totals the same as one
    // pass — and each commits its own cursor.
    for (;;) {
      const advanced = await this.prisma.$transaction(
        async (tx) => {
          const cursor = await tx.projectionCursor.findUniqueOrThrow({
            where: { name: CURSOR },
          });

          if (cursor.until >= until) return null;

          const next = new Date(
            Math.min(
              cursor.until.getTime() +
                PROJECTION_BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
              until.getTime(),
            ),
          );

          const rows = await this.projectInterval(tx, cursor.until, next);

          await tx.projectionCursor.update({
            where: { name: CURSOR },
            data: { until: next },
          });

          return rows.retrieved + rows.cited;
        },
        { timeout: PROJECTION_TRANSACTION_TIMEOUT_MS },
      );

      if (advanced === null) break;

      projected += advanced;
    }

    this.logger.log(`Backfill complete: ${projected} chunk counter update(s)`);

    return projected;
  }

  // -------------------------------------------------------------------------

  /**
   * The two UPDATEs, shared by both entry points so they cannot diverge.
   *
   * Written in SQL rather than as a read-modify-write loop: the arrays are
   * unnested and aggregated in one statement, so two overlapping runs cannot
   * interleave a read and a write and lose an increment.
   */
  private async projectInterval(
    tx: Prisma.TransactionClient,
    since: Date,
    until: Date,
  ): Promise<{ retrieved: number; cited: number }> {
    const retrieved = await tx.$executeRaw`
      UPDATE document_chunks AS c
      SET retrieval_count   = c.retrieval_count + usage.hits,
          last_retrieved_at = GREATEST(
            COALESCE(c.last_retrieved_at, usage.last_seen), usage.last_seen
          )
      FROM (
        SELECT chunk_id, COUNT(*) AS hits, MAX(created_at) AS last_seen
        FROM ai_generations, UNNEST(retrieved_chunk_ids) AS chunk_id
        WHERE created_at >= ${since} AND created_at < ${until}
        GROUP BY chunk_id
      ) AS usage
      WHERE c.id = usage.chunk_id
    `;

    const cited = await tx.$executeRaw`
      UPDATE document_chunks AS c
      SET citation_count = c.citation_count + usage.hits,
          last_cited_at  = GREATEST(
            COALESCE(c.last_cited_at, usage.last_seen), usage.last_seen
          )
      FROM (
        SELECT chunk_id, COUNT(*) AS hits, MAX(created_at) AS last_seen
        FROM ai_generations, UNNEST(cited_chunk_ids) AS chunk_id
        WHERE created_at >= ${since} AND created_at < ${until}
        GROUP BY chunk_id
      ) AS usage
      WHERE c.id = usage.chunk_id
    `;

    return { retrieved, cited };
  }

  /**
   * Zeroes every counter, a bounded batch at a time.
   *
   * The `WHERE` is what makes the loop terminate: a zeroed row stops matching,
   * so each statement takes locks on rows the previous one did not.
   */
  private async resetCounters(): Promise<number> {
    let total = 0;

    for (;;) {
      const zeroed = await this.prisma.$executeRaw`
        UPDATE document_chunks
        SET retrieval_count = 0, citation_count = 0
        WHERE id IN (
          SELECT id FROM document_chunks
          WHERE retrieval_count <> 0 OR citation_count <> 0
          LIMIT ${PROJECTION_RESET_BATCH}
        )
      `;

      total += zeroed;

      if (zeroed === 0) return total;
    }
  }
}
