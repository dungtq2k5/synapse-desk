import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  RAG_GRPC_CLIENT,
  RAG_SERVICE_NAME,
  RagServiceClient,
  SearchDegradation,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { KnowledgeSearchDto } from './dto/rest/knowledge.dto';
import { KnowledgeSearchResponseDto } from './dto/rest/knowledge-response.dto';

/**
 * The gateway's adapter for `rag-service`.
 *
 * A longer deadline than the shared default: retrieval embeds a query, queries
 * a vector index and runs a cross-encoder, and 5 seconds is sized for a
 * database lookup. A 504 here would mean "search is broken" to a user whose
 * search was merely working.
 */
const RETRIEVAL_DEADLINE_MS = 20_000;

@Injectable()
export class KnowledgeGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'rag-service';

  private ragService!: RagServiceClient;

  constructor(@Inject(RAG_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit(): void {
    this.ragService =
      this.client.getService<RagServiceClient>(RAG_SERVICE_NAME);
  }

  async search(
    dto: KnowledgeSearchDto,
    context: RequestContext,
  ): Promise<KnowledgeSearchResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.ragService.search(
          {
            query: dto.query,
            // Zero means "use the configured default", which is resolved
            // server-side from the settings layer rather than duplicated here.
            limit: dto.limit ?? 0,
            skipRerank: dto.skipRerank ?? false,
          },
          metadata,
        ),
      context,
      RETRIEVAL_DEADLINE_MS,
    );

    return {
      chunks: response.chunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        pageNumber: chunk.pageNumber ?? null,
        chunkIndex: chunk.chunkIndex,
        contentText: chunk.contentText,
        score: chunk.score,
        vectorPointId: chunk.vectorPointId,
      })),
      // Mapped to a STRING rather than passed through as a proto enum number:
      // `degraded: 1` in a JSON body is meaningless to a client, and the
      // client is the one that has to decide whether to tell the user.
      degraded:
        response.degraded === SearchDegradation.SEARCH_DEGRADATION_LEXICAL_ONLY
          ? 'LEXICAL_ONLY'
          : null,
    };
  }
}
