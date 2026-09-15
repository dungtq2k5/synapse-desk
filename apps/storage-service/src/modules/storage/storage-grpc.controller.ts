import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import { Observable } from 'rxjs';
import {
  ConfirmUploadRequest,
  DownloadObjectChunk,
  DownloadObjectRequest,
  ConfirmUploadResponse,
  GetSignedReadUrlsRequest,
  GetSignedReadUrlsResponse,
  IngestFromUrlRequest,
  IngestFromUrlResponse,
  PresignUploadRequest,
  PresignUploadResponse,
  StorageServiceController,
  StorageServiceControllerMethods,
  unpackCallerContext,
} from '@synapsedesk/grpc-proto';
import { StorageService } from './storage.service';

/**
 * Four methods. There is no delete — that is NATS-only, and the absence
 * is expressed in the proto so a contributor cannot add one here without first
 * noticing the contract has none to extend.
 */
@Controller()
@StorageServiceControllerMethods()
export class StorageGrpcController implements StorageServiceController {
  constructor(private readonly storage: StorageService) {}

  presignUpload(
    request: PresignUploadRequest,
    metadata?: Metadata,
  ): Promise<PresignUploadResponse> {
    return this.storage.presignUpload(request, unpackCallerContext(metadata));
  }

  confirmUpload(
    request: ConfirmUploadRequest,
    metadata?: Metadata,
  ): Promise<ConfirmUploadResponse> {
    return this.storage.confirmUpload(request, unpackCallerContext(metadata));
  }

  ingestFromUrl(
    request: IngestFromUrlRequest,
    metadata?: Metadata,
  ): Promise<IngestFromUrlResponse> {
    return this.storage.ingestFromUrl(request, unpackCallerContext(metadata));
  }

  getSignedReadUrls(
    request: GetSignedReadUrlsRequest,
    metadata?: Metadata,
  ): Promise<GetSignedReadUrlsResponse> {
    return this.storage.getSignedReadUrls(
      request,
      unpackCallerContext(metadata),
    );
  }

  /**
   * Returns an Observable, not a Promise — that is what makes it a gRPC SERVER
   * STREAM. Nest infers the streaming shape from the return type, so a
   * `Promise<Chunk[]>` here would compile, run, and silently be a unary call
   * that hits the message-size limit it was added to avoid.
   */
  downloadObject(
    request: DownloadObjectRequest,
    metadata?: Metadata,
  ): Observable<DownloadObjectChunk> {
    return this.storage.downloadObject(request, unpackCallerContext(metadata));
  }
}
