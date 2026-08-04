import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  ConfirmUploadRequest,
  ConfirmUploadResponse,
  GetSignedReadUrlsRequest,
  GetSignedReadUrlsResponse,
  PresignUploadRequest,
  PresignUploadResponse,
  StorageServiceController,
  StorageServiceControllerMethods,
  unpackCallerContext,
} from '@synapsedesk/grpc-proto';
import { StorageService } from './storage.service';

/**
 * Three methods. There is no delete — that is NATS-only (§1.6), and the absence
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

  getSignedReadUrls(
    request: GetSignedReadUrlsRequest,
    metadata?: Metadata,
  ): Promise<GetSignedReadUrlsResponse> {
    return this.storage.getSignedReadUrls(
      request,
      unpackCallerContext(metadata),
    );
  }
}
