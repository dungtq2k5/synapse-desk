import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  RAG_GRPC_CLIENT,
  RAG_SERVICE_NAME,
  RagServiceClient,
  SearchRequest,
  SearchResponse,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

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

  search(
    request: SearchRequest,
    context: RequestContext,
  ): Promise<SearchResponse> {
    return this.call(
      (metadata) => this.ragService.search(request, metadata),
      context,
      RETRIEVAL_DEADLINE_MS,
    );
  }
}
