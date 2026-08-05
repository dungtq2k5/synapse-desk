import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Rolls the ledger's chunk arrays into `document_chunks` counters — §4.1.
 *
 * **A projection rather than a query, and the reason is retention.** An earlier
 * draft called the document flags "a pure query over
 * `ai_generations.retrieved_chunk_ids`". It is not pure, and worse, it is
 * temporary: retention rolls the ledger into daily per-(org, purpose, model)
 * aggregates that **do not carry the chunk arrays** (RDM Table 29), so a flag
 * defined against them stops working the moment rollups ship — silently,
 * reporting zero findings, which reads exactly like a healthy corpus.
 *
 * **Ordering constraint, and it is real: projection BEFORE retention over the
 * same window.** Reversed, the retention job deletes rows the projection has
 * not read yet, and the counters under-report forever with nothing to
 * recompute them from.
 */
@Injectable()
export class ChunkUsageProjection {
  private readonly logger = new Logger(ChunkUsageProjection.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Projects every generation in `[since, until)`.
   *
   * A half-open interval, so consecutive runs neither skip a row nor count one
   * twice — a closed interval double-counts every row landing exactly on a
   * boundary, which at second granularity is rare enough to look like noise
   * and frequent enough to matter over months.
   *
   * Written in SQL rather than as a read-modify-write loop: the arrays are
   * unnested and aggregated in one statement, so two overlapping runs cannot
   * interleave a read and a write and lose an increment.
   */
  async project(since: Date, until: Date): Promise<number> {
    const [retrieved, cited] = await this.prisma.$transaction([
      this.prisma.$executeRaw`
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
      `,
      this.prisma.$executeRaw`
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
      `,
    ]);

    this.logger.log(
      `Projected usage onto ${retrieved} retrieved and ${cited} cited chunk row(s)`,
    );

    return retrieved + cited;
  }
}
