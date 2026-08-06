import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  ConfirmDocumentRequest,
  DeleteDocumentResponse,
  DocumentChunkResponse,
  DocumentIdRequest,
  DocumentResponse,
  DocumentServiceController,
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

/**
 * Every method unpacks the caller context, because every query is scoped by it
 * — the tenant filter AND the org-wide ∪ departments filter both read it.
 * Unpacking uniformly rather than only where a write needs an actor id is what
 * stops an RPC being added with an unscoped read.
 */
@Controller()
@DocumentServiceControllerMethods()
export class DocumentsGrpcController implements DocumentServiceController {
  constructor(private readonly documents: DocumentsService) {}

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
    return this.documents.listDocumentFlags(
      request,
      unpackCallerContext(metadata),
    );
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
}
