import { Injectable, Logger } from '@nestjs/common';
import { formatErrorMsg } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentScope, ScopeWriterService } from './scope-writer.service';

/**
 * How many documents one run will repair.
 *
 * A bound, not a tuning knob. Repair is a Qdrant write plus a chunk `updateMany`
 * per document, so an unbounded run over a large drift set is the sweep becoming
 * the incident. Anything beyond the cap is reported and picked up next hour.
 */
export const MAX_REPAIRED_PER_RUN = 50;

/** What the sweep did. Two counters, deliberately not one — see the docblock. */
export type ScopeReconcileResult = {
  /**
   * Repaired documents whose chunks were WIDER than the truth.
   *
   * **Reported separately because this is an access-control failure that was
   * being served.** A restriction whose chunk write failed leaves the lexical
   * arm answering with the old, wider scope — someone can retrieve a document
   * they were removed from. Averaging it into a maintenance number is how a
   * security condition gets read as a statistic.
   */
  repairedWider: number;
  /** Repaired documents whose chunks were NARROWER — findable nowhere. */
  repairedNarrower: number;
  /** Drifting documents left for the next run because the cap was hit. */
  deferred: number;
  /** Repairs that threw. Counted so a persistent failure is visible. */
  failed: number;
  /**
   * Chunks whose `organization_id` disagrees with their document.
   *
   * **Reported, never repaired** — see the sweep's docblock.
   */
  tenantMismatches: number;
};

/**
 * Detects and repairs `document_chunks` scope drift.
 *
 * `ScopeWriterService.apply()` writes Postgres and Qdrant, which cannot share a
 * transaction. Its ordering makes each partial failure fail safely in one
 * direction, and nothing has ever checked that the second write landed. This is
 * the detector.
 *
 * **The SQL below is a CANDIDATE FILTER; `findScopeDrift` is the verdict.**
 * That division is deliberate and it sets how exact the SQL must be: a false
 * candidate costs one `findScopeDrift` call and is dropped, and can never cause
 * a write. What the SQL must not do is MISS a drifting document, because
 * nothing downstream would ever look at it again.
 *
 * Reusing `findScopeDrift` rather than re-deriving the comparison is the same
 * argument that has repair go through `apply()`: a second implementation of a
 * comparison is a second thing that can disagree with the first, and a sweep
 * that repairs what the fan-out considers fine would fight it forever.
 */
@Injectable()
export class ScopeReconcileSweep {
  private readonly logger = new Logger(ScopeReconcileSweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeWriter: ScopeWriterService,
  ) {}

  async sweep(): Promise<ScopeReconcileResult> {
    const result: ScopeReconcileResult = {
      repairedWider: 0,
      repairedNarrower: 0,
      deferred: 0,
      failed: 0,
      tenantMismatches: await this.countTenantMismatches(),
    };

    const candidates = await this.findCandidates();

    for (const documentId of candidates.slice(0, MAX_REPAIRED_PER_RUN)) {
      try {
        await this.repairOne(documentId, result);
      } catch (error) {
        // One document's failure must not end the run: the drift behind it is
        // unrelated, and a sweep that stops at the first bad row repairs
        // nothing on every subsequent tick.
        result.failed += 1;
        this.logger.error(
          `Could not repair scope for ${documentId}: ${formatErrorMsg(error)}`,
        );
      }
    }

    result.deferred = Math.max(0, candidates.length - MAX_REPAIRED_PER_RUN);

    return this.report(result);
  }

  /**
   * Documents whose chunk rows MIGHT disagree with their document.
   *
   * `ORDER BY random()`, and the reason is that every deterministic ordering
   * starves. A document whose repair keeps failing is retried first on every run
   * and eats the budget ahead of the drift behind it.
   *
   * Ordering by `documents.updated_at` looks like the fix and is not: **repair
   * never touches `documents`.** It writes `document_chunks` and Qdrant, and
   * rewriting the source of truth is deliberately out of scope — so no timestamp
   * advances and the failing document keeps its place at the front forever.
   * `document_chunks` carries only `createdAt`.
   *
   * Random gives every drifting document the same chance each run, so a
   * persistent failure delays the rest rather than blocking them. The sort is
   * affordable precisely because drift should be near zero — and if it is not,
   * the alert firing is the finding, not the ordering.
   *
   * **`@>` and `<@`, never `=`, and for BUDGET rather than correctness.**
   * Postgres array equality is order-sensitive, `department_ids` is written from
   * a JavaScript array, and `array_agg` has no defined order — so `=` would
   * nominate most multi-department documents every run. None would be repaired,
   * because `findScopeDrift` compares sets and rejects them; what it would cost
   * is the candidate budget, with real drift queued behind documents that were
   * always fine.
   */
  private async findCandidates(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ document_id: string }[]>`
      SELECT document_id FROM (
        SELECT DISTINCT c.document_id
        FROM document_chunks c
        JOIN documents d ON d.id = c.document_id
        LEFT JOIN LATERAL (
          SELECT coalesce(array_agg(dd.department_id), '{}'::uuid[]) AS ids
          FROM department_documents dd
          WHERE dd.document_id = d.id
        ) links ON TRUE
        WHERE c.is_organization_wide IS DISTINCT FROM d.is_organization_wide
           OR c.is_deleted IS DISTINCT FROM (d.deleted_at IS NOT NULL)
           OR NOT (c.department_ids @> links.ids AND c.department_ids <@ links.ids)
      ) candidates
      -- Ordered OUTSIDE the DISTINCT: Postgres refuses a SELECT DISTINCT whose
      -- ORDER BY expression is not in the select list (42P10), and random()
      -- never can be. No backticks in here -- this is a template literal.
      ORDER BY random()
      LIMIT ${MAX_REPAIRED_PER_RUN + 1}
    `;

    return rows.map((row) => row.document_id);
  }

  /**
   * Chunks filed under a different tenant than their document.
   *
   * **Counted, never repaired.** Nothing in the system updates
   * `document_chunks.organization_id` — `writeChunks` sets three columns and
   * this is not one of them, so it is written once at ingestion and never
   * touched again. A mismatch therefore is not drift: it means something wrote
   * the wrong tenant, into the column the lexical arm filters on.
   *
   * Repairing it would move rows between tenants and erase the evidence of the
   * bug that put them there. It should be zero forever; if it is not, a human
   * decides what moves.
   */
  private async countTenantMismatches(): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE c.organization_id IS DISTINCT FROM d.organization_id
    `;

    return Number(row?.count ?? 0);
  }

  /** Recomputes the truth and re-applies it through the one writer. */
  private async repairOne(
    documentId: string,
    result: ScopeReconcileResult,
  ): Promise<void> {
    const drifted = await this.scopeWriter.findScopeDrift(documentId);
    // The candidate query is allowed to over-select; this is the verdict.
    if (drifted.length === 0) return;

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { departmentLinks: { select: { departmentId: true } } },
    });
    if (!document) return;

    const truth: DocumentScope = {
      isOrganizationWide: document.isOrganizationWide,
      departmentIds: document.departmentLinks.map((link) => link.departmentId),
      isDeleted: document.deletedAt !== null,
    };

    const current = await this.currentChunkScope(documentId, truth);

    // **`current` as `before`, never `truth` twice.** `apply()` derives
    // `restricting` from `isRestriction(before, after)`, so passing `truth` for
    // both makes that false and routes a NARROWING repair down the grant path —
    // chunks first, Qdrant non-fatal, which is the exact ordering a restriction
    // must never take. It type-checks, it runs, and nothing looks wrong.
    const { restricting } = await this.scopeWriter.apply(
      documentId,
      document.organizationId,
      truth,
      current,
    );

    if (restricting) result.repairedWider += 1;
    else result.repairedNarrower += 1;
  }

  /**
   * The scope the chunk rows currently claim.
   *
   * Read from a drifting row rather than assumed, because it is what decides
   * which ordering `apply()` takes. Falls back to the truth when there are no
   * rows, which makes the change a no-op rather than a guess.
   */
  private async currentChunkScope(
    documentId: string,
    fallback: DocumentScope,
  ): Promise<DocumentScope> {
    const chunk = await this.prisma.documentChunk.findFirst({
      where: { documentId },
      select: {
        isOrganizationWide: true,
        departmentIds: true,
        isDeleted: true,
      },
    });

    return chunk ?? fallback;
  }

  /**
   * One line per run, unconditionally.
   *
   * Including the zero case: a sweep that logs only when it finds work is
   * indistinguishable from one that is not running.
   */
  private report(result: ScopeReconcileResult): ScopeReconcileResult {
    if (result.deferred > 0) {
      // Never truncate silently. This number staying flat across runs is the
      // signal that repair is failing rather than that drift is clearing.
      this.logger.warn(
        `Scope reconcile hit the cap: repaired ${MAX_REPAIRED_PER_RUN}, ${result.deferred}+ still drifting`,
      );
    }

    if (result.tenantMismatches > 0) {
      // `error`, not `warn`: this is the tenant boundary, and it cannot drift.
      this.logger.error(
        `${result.tenantMismatches} chunk(s) are filed under a different tenant than their document — NOT repaired, a human must decide`,
      );
    }

    this.logger.log(
      `Scope reconcile: ${result.repairedWider} wider, ${result.repairedNarrower} narrower, ` +
        `${result.failed} failed, ${result.deferred} deferred`,
    );

    return result;
  }
}
