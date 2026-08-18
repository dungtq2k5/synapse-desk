import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { formatErrorMsg, isRestrictingChange } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { QdrantService } from '../qdrant/qdrant.service';

export type DocumentScope = {
  isOrganizationWide: boolean;
  departmentIds: string[];
  isDeleted: boolean;
};

/**
 * The ONE place a visibility change touches the retrievable stores.
 *
 * `document_chunks` and the Qdrant payload carry the same four scope fields, so
 * every change is written twice — and **the order is a security property that
 * is not symmetric**:
 *
 * - **Restrictions** — Qdrant first, then `document_chunks`, then
 * `documents`. Both retrievable stores are written SYNCHRONOUSLY.
 * - **Grants** — `documents` first.
 *
 * Reverse a restriction and the document is IT-only in every list view and
 * still retrievable by everyone, with nothing erroring.
 *
 * The BullMQ job is the RECONCILER, not the writer: it re-applies the same
 * scope with retries so a partial failure converges.
 *
 * See `docs/decisions/0036-scope-fanout-order-is-asymmetric.md`.
 */
@Injectable()
export class ScopeWriterService {
  private readonly logger = new Logger(ScopeWriterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qdrant: QdrantService,
  ) {}

  /** Whether this change takes access away from anyone. */
  isRestriction(before: DocumentScope, after: DocumentScope): boolean {
    return isRestrictingChange(before, after);
  }

  /**
   * Applies a scope change to both retrievable stores, in the right order.
   *
   * Throws UNAVAILABLE if the leading store cannot be written on a restriction.
   * That is deliberate and it is the honest answer: nothing has been narrowed
   * yet, so reporting success would tell an admin they had restricted a
   * document that is still fully visible — the one outcome worse than an
   * error.
   */
  async apply(
    documentId: string,
    after: DocumentScope,
    before: DocumentScope,
  ): Promise<{ restricting: boolean }> {
    const restricting = this.isRestriction(before, after);

    if (restricting) {
      await this.writeQdrant(documentId, after, { fatal: true });
      await this.writeChunks(documentId, after);
    } else {
      // A grant. `documents` has already been written by the caller — it is
      // the row the endpoint is updating — so the chunk rows come next and
      // Qdrant last. A failure here leaves the document listed but not yet
      // retrievable: someone waits, which is the safe direction.
      await this.writeChunks(documentId, after);
      await this.writeQdrant(documentId, after, { fatal: false });
    }

    return { restricting };
  }

  /**
   * The chunk rows — one `updateMany`, never a page-by-page loop.
   *
   * A document with more chunks than one page is the ordinary case, and a loop
   * that stopped after the first page would leave the TAIL of a long document
   * at the old scope: retrievable by exactly the people who just lost access,
   * and only for the part nobody thought to check.
   */
  async writeChunks(documentId: string, scope: DocumentScope): Promise<number> {
    const result = await this.prisma.documentChunk.updateMany({
      where: { documentId },
      data: {
        isOrganizationWide: scope.isOrganizationWide,
        departmentIds: scope.departmentIds,
        isDeleted: scope.isDeleted,
      },
    });

    return result.count;
  }

  /**
   * The Qdrant payload.
   *
   * `fatal` decides whether a failure reaches the caller, and the two cases are
   * genuinely different: on a restriction nothing has been narrowed yet, so
   * silence would be a lie; on a grant the document is merely not yet
   * retrievable, and the reconciler will finish the job.
   */
  async writeQdrant(
    documentId: string,
    scope: DocumentScope,
    { fatal }: { fatal: boolean },
  ): Promise<void> {
    try {
      await this.qdrant.setDocumentScope(documentId, scope);
    } catch (error) {
      const message = formatErrorMsg(error);

      if (fatal) {
        this.logger.error(
          `Could not restrict ${documentId} in the vector store: ${message}`,
        );
        throw new RpcException({
          code: status.UNAVAILABLE,
          message:
            'The visibility change could not be applied to the search index; nothing was changed. Please try again.',
        });
      }

      // Non-fatal: logged and left to the reconciler. Loud, because from the
      // outside this looks exactly like a document waiting its turn.
      this.logger.warn(
        `Deferred the vector-store grant for ${documentId}: ${message}`,
      );
    }
  }

  /**
   * Chunk rows whose scope disagrees with their parent `documents` row.
   *
   * Denormalisation's own failure mode: the fan-out missed a row and retrieval
   * is now serving a stale boundary. Nothing errors — the query simply returns
   * different results from the list view, and only a comparison finds it.
   */
  async findScopeDrift(documentId: string): Promise<string[]> {
    const [document, chunks] = await Promise.all([
      this.prisma.document.findUnique({
        where: { id: documentId },
        include: { departmentLinks: { select: { departmentId: true } } },
      }),
      this.prisma.documentChunk.findMany({
        where: { documentId },
        select: {
          id: true,
          isOrganizationWide: true,
          departmentIds: true,
          isDeleted: true,
        },
      }),
    ]);

    if (!document) return [];

    const expected = new Set(
      document.departmentLinks.map((link) => link.departmentId),
    );
    const expectedDeleted = document.deletedAt !== null;

    return chunks
      .filter(
        (chunk) =>
          chunk.isOrganizationWide !== document.isOrganizationWide ||
          chunk.isDeleted !== expectedDeleted ||
          chunk.departmentIds.length !== expected.size ||
          chunk.departmentIds.some((id) => !expected.has(id)),
      )
      .map((chunk) => chunk.id);
  }

  /**
   * The document's scope as it is RIGHT NOW.
   *
   * The reconciler's input, so a deferred job converges on the truth rather
   * than replaying a snapshot that a later change has already overtaken. Null
   * when the row is gone.
   */
  async currentScope(documentId: string): Promise<DocumentScope | null> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        isOrganizationWide: true,
        deletedAt: true,
        departmentLinks: { select: { departmentId: true } },
      },
    });

    if (!document) return null;

    return {
      isOrganizationWide: document.isOrganizationWide,
      departmentIds: document.departmentLinks.map((link) => link.departmentId),
      // A soft delete IS the scope change, which is why retrieval reads
      // `is_deleted` on the chunk rather than joining `documents`.
      isDeleted: document.deletedAt !== null,
    };
  }
}
