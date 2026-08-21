import { Controller } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { Metadata } from '@grpc/grpc-js';
import {
  ListDocumentChunksByIdsRequest,
  ListDocumentChunksByIdsResponse,
  ListDocumentsByIdsRequest,
  ListDocumentsByIdsResponse,
  ConfirmDocumentRequest,
  DeleteDocumentResponse,
  DocumentChunkResponse,
  DeleteDocumentFlagResponse,
  DocumentFlagIdRequest,
  DocumentFlagResponse,
  ResolveDocumentFlagRequest,
  fromProtoDocumentFlagResolution,
  DocumentIdRequest,
  DocumentResponse,
  GetKnowledgeArticleRequest,
  KnowledgeArticleDetailResponse,
  ListKnowledgeArticlesRequest,
  ListKnowledgeArticlesResponse,
  CancelIngestionJobResponse,
  DocumentServiceController,
  IngestionJobIdRequest,
  IngestionJobResponse,
  ReplaceDocumentRequest,
  ListIngestionJobsRequest,
  ListIngestionJobsResponse,
  DocumentServiceControllerMethods,
  DownloadDocumentResponse,
  GetDocumentChunkRequest,
  ListDocumentChunksRequest,
  ListDocumentChunksResponse,
  ListDocumentFlagsRequest,
  ListDocumentFlagsResponse,
  ListDocumentDepartmentsResponse,
  ListDocumentsRequest,
  ListDocumentsResponse,
  PresignDocumentRequest,
  PresignDocumentResponse,
  SetDocumentDepartmentsRequest,
  StorageUsageResponse,
  unpackCallerContext,
  UpdateDocumentRequest,
} from '@synapsedesk/grpc-proto';
import { DocumentsService } from './documents.service';
import { IngestionJobsService } from '../ingestion-jobs/ingestion-jobs.service';
import { DocumentFlagsService } from '../document-flags/document-flags.service';
import { KnowledgeArticlesService } from '../knowledge-articles/knowledge-articles.service';

/**
 * Every method unpacks the caller context, because every query is scoped by it
 * — the tenant filter AND the org-wide ∪ departments filter both read it.
 * Unpacking uniformly rather than only where a write needs an actor id is what
 * stops an RPC being added with an unscoped read.
 */
@Controller()
@DocumentServiceControllerMethods()
export class DocumentsGrpcController implements DocumentServiceController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly jobs: IngestionJobsService,
    private readonly flags: DocumentFlagsService,
    private readonly articles: KnowledgeArticlesService,
  ) {}

  presignDocument(
    request: PresignDocumentRequest,
    metadata?: Metadata,
  ): Promise<PresignDocumentResponse> {
    return this.documents.presignDocument(
      request,
      unpackCallerContext(metadata),
    );
  }

  confirmDocument(
    request: ConfirmDocumentRequest,
    metadata?: Metadata,
  ): Promise<DocumentResponse> {
    return this.documents.confirmDocument(
      request,
      unpackCallerContext(metadata),
    );
  }

  listDocumentsByIds(
    request: ListDocumentsByIdsRequest,
    metadata?: Metadata,
  ): Promise<ListDocumentsByIdsResponse> {
    return this.documents.listDocumentsByIds(
      request,
      unpackCallerContext(metadata),
    );
  }

  listDocumentChunksByIds(
    request: ListDocumentChunksByIdsRequest,
    metadata?: Metadata,
  ): Promise<ListDocumentChunksByIdsResponse> {
    return this.documents.listDocumentChunksByIds(
      request,
      unpackCallerContext(metadata),
    );
  }

  listDocuments(
    request: ListDocumentsRequest,
    metadata?: Metadata,
  ): Promise<ListDocumentsResponse> {
    return this.documents.listDocuments(request, unpackCallerContext(metadata));
  }

  getDocument(
    request: DocumentIdRequest,
    metadata?: Metadata,
  ): Promise<DocumentResponse> {
    return this.documents.getDocument(request, unpackCallerContext(metadata));
  }

  updateDocument(
    request: UpdateDocumentRequest,
    metadata?: Metadata,
  ): Promise<DocumentResponse> {
    return this.documents.updateDocument(
      request,
      unpackCallerContext(metadata),
    );
  }

  deleteDocument(
    request: DocumentIdRequest,
    metadata?: Metadata,
  ): Promise<DeleteDocumentResponse> {
    return this.documents.deleteDocument(
      request,
      unpackCallerContext(metadata),
    );
  }

  restoreDocument(
    request: DocumentIdRequest,
    metadata?: Metadata,
  ): Promise<DocumentResponse> {
    return this.documents.restoreDocument(
      request,
      unpackCallerContext(metadata),
    );
  }

  reindexDocument(
    request: DocumentIdRequest,
    metadata?: Metadata,
  ): Promise<IngestionJobResponse> {
    return this.documents.reindexDocument(
      request,
      unpackCallerContext(metadata),
    );
  }

  replaceDocument(
    request: ReplaceDocumentRequest,
    metadata?: Metadata,
  ): Promise<DocumentResponse> {
    return this.documents.replaceDocument(
      request,
      unpackCallerContext(metadata),
    );
  }

  downloadDocument(
    request: DocumentIdRequest,
    metadata?: Metadata,
  ): Promise<DownloadDocumentResponse> {
    return this.documents.downloadDocument(
      request,
      unpackCallerContext(metadata),
    );
  }

  listDocumentDepartments(
    request: DocumentIdRequest,
    metadata?: Metadata,
  ): Promise<ListDocumentDepartmentsResponse> {
    return this.documents.listDocumentDepartments(
      request,
      unpackCallerContext(metadata),
    );
  }

  setDocumentDepartments(
    request: SetDocumentDepartmentsRequest,
    metadata?: Metadata,
  ): Promise<DocumentResponse> {
    return this.documents.setDocumentDepartments(
      request,
      unpackCallerContext(metadata),
    );
  }

  listDocumentChunks(
    request: ListDocumentChunksRequest,
    metadata?: Metadata,
  ): Promise<ListDocumentChunksResponse> {
    return this.documents.listDocumentChunks(
      request,
      unpackCallerContext(metadata),
    );
  }

  listDocumentFlags(
    request: ListDocumentFlagsRequest,
    metadata?: Metadata,
  ): Promise<ListDocumentFlagsResponse> {
    return this.flags.listDocumentFlags(request, unpackCallerContext(metadata));
  }

  getDocumentChunk(
    request: GetDocumentChunkRequest,
    metadata?: Metadata,
  ): Promise<DocumentChunkResponse> {
    return this.documents.getDocumentChunk(
      request,
      unpackCallerContext(metadata),
    );
  }

  /**
   * The request message is a `DocumentIdRequest` only because the proto reuses
   * it; the id is ignored. Storage usage is a WORKSPACE total, not a
   * per-document one.
   */
  getStorageUsage(
    _request: DocumentIdRequest,
    metadata?: Metadata,
  ): Promise<StorageUsageResponse> {
    return this.documents.getStorageUsage(unpackCallerContext(metadata));
  }

  // ---------------------------------------------------------------- flags
  //
  // Stubs so the tree compiles at this gate rather than staying red until the
  // module lands — the shape `listSimilarTickets` uses, and doc 40 before it.

  getDocumentFlag(
    request: DocumentFlagIdRequest,
    metadata?: Metadata,
  ): Promise<DocumentFlagResponse> {
    return this.flags.getDocumentFlag(
      request.id,
      unpackCallerContext(metadata),
    );
  }

  /**
   * One RPC for three routes — they differ only in the value they carry.
   *
   * @throws RpcException INVALID_ARGUMENT when `resolution` is UNSPECIFIED,
   * which is a legal value of the enum type and not a legal resolution. The
   * check is here because the service takes the DOMAIN enum, where UNSPECIFIED
   * is not representable at all.
   */
  resolveDocumentFlag(
    request: ResolveDocumentFlagRequest,
    metadata?: Metadata,
  ): Promise<DocumentFlagResponse> {
    const resolution = fromProtoDocumentFlagResolution(request.resolution);

    if (!resolution) {
      return Promise.reject(
        new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'A resolution is required',
        }),
      );
    }

    return this.flags.resolve(
      request.id,
      resolution,
      unpackCallerContext(metadata),
      request.comment,
    );
  }

  deleteDocumentFlag(
    request: DocumentFlagIdRequest,
    metadata?: Metadata,
  ): Promise<DeleteDocumentFlagResponse> {
    return this.flags.deleteDocumentFlag(
      request.id,
      unpackCallerContext(metadata),
    );
  }

  // ------------------------------------------------------------- articles
  //
  // Stubs so the tree compiles at this gate rather than staying red until the
  // module lands — doc 40's shape, and doc 41's before it.

  listKnowledgeArticles(
    request: ListKnowledgeArticlesRequest,
    metadata?: Metadata,
  ): Promise<ListKnowledgeArticlesResponse> {
    return this.articles.listKnowledgeArticles(
      request,
      unpackCallerContext(metadata),
    );
  }

  getKnowledgeArticle(
    request: GetKnowledgeArticleRequest,
    metadata?: Metadata,
  ): Promise<KnowledgeArticleDetailResponse> {
    return this.articles.getKnowledgeArticle(
      request,
      unpackCallerContext(metadata),
    );
  }

  // ---------------------------------------------------------------- jobs
  //
  // The one place this controller delegates elsewhere: the RPCs are declared on
  // `DocumentService`, and ts-proto's generated decorator covers a whole
  // service at once, so their adapter has to live here.

  listIngestionJobs(
    request: ListIngestionJobsRequest,
    metadata?: Metadata,
  ): Promise<ListIngestionJobsResponse> {
    return this.jobs.listIngestionJobs(request, unpackCallerContext(metadata));
  }

  getIngestionJob(
    request: IngestionJobIdRequest,
    metadata?: Metadata,
  ): Promise<IngestionJobResponse> {
    return this.jobs.getIngestionJob(request, unpackCallerContext(metadata));
  }

  retryIngestionJob(
    request: IngestionJobIdRequest,
    metadata?: Metadata,
  ): Promise<IngestionJobResponse> {
    return this.jobs.retryIngestionJob(request, unpackCallerContext(metadata));
  }

  cancelIngestionJob(
    request: IngestionJobIdRequest,
    metadata?: Metadata,
  ): Promise<CancelIngestionJobResponse> {
    return this.jobs.cancelIngestionJob(request, unpackCallerContext(metadata));
  }

  listDocumentIngestionJobs(
    request: DocumentIdRequest,
    metadata?: Metadata,
  ): Promise<ListIngestionJobsResponse> {
    return this.jobs.listDocumentIngestionJobs(
      request,
      unpackCallerContext(metadata),
    );
  }
}
