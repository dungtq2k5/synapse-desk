import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  GetKnowledgeArticleRequest,
  KnowledgeArticleDetailResponse,
  ListKnowledgeArticlesRequest,
  ListKnowledgeArticlesResponse,
  emptyPage,
  toPageMeta,
  toPrismaPage,
  toSearchFilter,
} from '@synapsedesk/grpc-proto';
import {
  CallerContext,
  DOCUMENT_CHUNK_SORTABLE_FIELDS,
  DocumentFlagType,
  DocumentStatus,
  requireTenant,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { documentVisibility } from '../../common/document-visibility';
import { Prisma } from '../../generated/prisma/client';
import {
  toKnowledgeArticleBlockResponse,
  toKnowledgeArticleResponse,
} from './knowledge-article.mapper';

/** What an end user may sort a help centre by. */
// Local rather than in `libs/common`: one consumer, and §3.1 says a second has
// to exist or be imminent before a constant moves.
const KNOWLEDGE_ARTICLE_SORTABLE_FIELDS = ['updatedAt', 'title'] as const;

/**
 * The help centre: the corpus as an END USER sees it.
 *
 * **An article is a document that is visible, `INDEXED`, and not soft-deleted.**
 * All three, and the third is the one that disappears: `documentVisibility` is
 * only the org-wide ∪ departments clause, and `deleteDocument` writes just
 * `softDeleteData` — a soft-deleted document keeps `status = INDEXED` forever.
 * Two predicates would list deleted documents to end users by title.
 *
 * `INDEXED` is not decoration either. A document that parses to nothing throws
 * `NoExtractableText` and ends `FAILED`, so the status that defines an article
 * is the same status that guarantees {@link getKnowledgeArticle} has text to
 * return.
 */
@Injectable()
export class KnowledgeArticlesService {
  constructor(private readonly prisma: PrismaService) {}

  async listKnowledgeArticles(
    request: ListKnowledgeArticlesRequest,
    context: CallerContext,
  ): Promise<ListKnowledgeArticlesResponse> {
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(
      page,
      KNOWLEDGE_ARTICLE_SORTABLE_FIELDS,
    );
    // HONOURED, not merely accepted. Searching titles is the first thing an end
    // user does here, and a filter that is advertised and dropped answers a
    // different question than the one asked.
    const search = toSearchFilter(page.searchTerm);

    const where: Prisma.DocumentWhereInput = {
      ...this.scope(context),
      ...(search ? { title: search } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { _count: { select: { chunks: true } } },
      }),
      // The SAME `where`. A count computed without the scope would tell an end
      // user how many articles exist that they cannot open.
      this.prisma.document.count({ where }),
    ]);

    return {
      items: items.map(toKnowledgeArticleResponse),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  /**
   * One article, with a page of its extracted text.
   *
   * Paginated by CHUNK RANGE rather than returned whole: `CHUNK_TARGET_TOKENS`
   * bounds each block and a 200-page handbook is hundreds of them.
   *
   * @throws RpcException NOT_FOUND when no article matches — including a
   * document this caller may not see, one still processing, and one deleted.
   */
  async getKnowledgeArticle(
    request: GetKnowledgeArticleRequest,
    context: CallerContext,
  ): Promise<KnowledgeArticleDetailResponse> {
    const page = request.page ?? emptyPage();
    // The chunk allowlist, not the article one: `?sortBy=title` on a list of
    // blocks is a request this cannot honour, and honouring the wrong column
    // silently would reorder the document.
    //
    // **Unreachable from the gateway, and REAL defence all the same.** The
    // blocks DTO cannot send `sortBy`, so no test through the gateway can
    // exercise this — but `toPrismaPage` THROWS `INVALID_ARGUMENT` rather than
    // falling back, so a second gRPC caller asking for `title` gets an error
    // instead of a scrambled document. It also supplies `chunkIndex` for the
    // empty `sortBy` the gateway does send, which is why the gateway names no
    // column of its own.
    const { skip, take } = toPrismaPage(page, DOCUMENT_CHUNK_SORTABLE_FIELDS);

    // **Read THROUGH the article, never `documentChunk.findMany({ documentId })`.**
    // Chunk rows carry their own `isDeleted`, `isOrganizationWide` and
    // `departmentIds`, and a query starting from the chunk table inherits none
    // of the three predicates above.
    const article = await this.prisma.document.findFirst({
      where: { id: request.id, ...this.scope(context) },
      include: {
        _count: { select: { chunks: true } },
        chunks: {
          skip,
          take,
          // Fixed, not caller-chosen: the blocks ARE the document, in order.
          orderBy: { chunkIndex: 'asc' },
        },
      },
    });

    if (!article) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No article with that id',
      });
    }

    // One `findFirst`, on the detail read only — the list would be an N+1 for a
    // signal a reader needs when they are actually reading.
    //
    // An OPEN flag now means what its name says: `reportMissingPages` closes it
    // when a re-index reads every page (`resolveSystem`). Without that fix this
    // would stay true forever after the pages were fixed.
    const unindexed = await this.prisma.documentFlag.findFirst({
      where: {
        documentId: article.id,
        flagType: DocumentFlagType.PAGES_NOT_INDEXED,
        resolvedAt: null,
      },
      select: { id: true },
    });

    return {
      article: toKnowledgeArticleResponse(article),
      blocks: article.chunks.map(toKnowledgeArticleBlockResponse),
      // Over the BLOCK count, so a reader can page through the document.
      meta: toPageMeta(page, article._count.chunks, article.chunks.length),
      hasUnindexedPages: unindexed !== null,
    };
  }

  /** The three predicates that define an article, in one place. */
  private scope(context: CallerContext): Prisma.DocumentWhereInput {
    return {
      organizationId: requireTenant(context),
      deletedAt: null,
      status: DocumentStatus.INDEXED,
      ...documentVisibility(context),
    };
  }
}
