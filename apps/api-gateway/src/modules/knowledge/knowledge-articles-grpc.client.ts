import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  DOCUMENT_SERVICE_NAME,
  DocumentServiceClient,
  GetKnowledgeArticleRequest,
  INGESTION_GRPC_CLIENT,
  KnowledgeArticleDetailResponse,
  ListKnowledgeArticlesRequest,
  ListKnowledgeArticlesResponse,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

/**
 * The ingestion-service RPCs behind the help centre.
 *
 * A SECOND client in this module, beside `KnowledgeGrpcClient`: the two routes
 * share a URL prefix and an audience with `search` and `ask`, and nothing else
 * — those reach `rag-service`, these reach `ingestion-service`.
 */
@Injectable()
export class KnowledgeArticlesGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'ingestion-service';

  private documentGrpcService!: DocumentServiceClient;

  constructor(
    @Inject(INGESTION_GRPC_CLIENT) private readonly client: ClientGrpc,
  ) {
    super();
  }

  onModuleInit(): void {
    // The same peer connection the documents module uses — these RPCs are
    // declared on `DocumentService`.
    this.documentGrpcService = this.client.getService<DocumentServiceClient>(
      DOCUMENT_SERVICE_NAME,
    );
  }

  list(
    request: ListKnowledgeArticlesRequest,
    context: RequestContext,
  ): Promise<ListKnowledgeArticlesResponse> {
    return this.call(
      (metadata) =>
        this.documentGrpcService.listKnowledgeArticles(request, metadata),
      context,
    );
  }

  get(
    request: GetKnowledgeArticleRequest,
    context: RequestContext,
  ): Promise<KnowledgeArticleDetailResponse> {
    return this.call(
      (metadata) =>
        this.documentGrpcService.getKnowledgeArticle(request, metadata),
      context,
    );
  }
}
