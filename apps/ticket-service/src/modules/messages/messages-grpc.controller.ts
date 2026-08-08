import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  AppendAiMessageRequest,
  AttachmentResponse,
  ConfirmAttachmentRequest,
  CreateMessageRequest,
  DeleteAttachmentRequest,
  DeleteAttachmentResponse,
  ListAttachmentsRequest,
  ListAttachmentsResponse,
  PresignAttachmentResponse,
  DownloadAttachmentRequest,
  DownloadAttachmentResponse,
  ListMessagesRequest,
  ListMessagesResponse,
  MessageResponse,
  MessageServiceController,
  MessageServiceControllerMethods,
  RedactMessageRequest,
  RedactMessageResponse,
  unpackCallerContext,
  UpdateMessageRequest,
  UploadAttachmentRequest,
} from '@synapsedesk/grpc-proto';
import { MessagesService } from './messages.service';

@Controller()
@MessageServiceControllerMethods()
export class MessagesGrpcController implements MessageServiceController {
  constructor(private readonly messages: MessagesService) {}

  createMessage(
    request: CreateMessageRequest,
    metadata?: Metadata,
  ): Promise<MessageResponse> {
    return this.messages.createMessage(request, unpackCallerContext(metadata));
  }

  appendAiMessage(
    request: AppendAiMessageRequest,
    metadata?: Metadata,
  ): Promise<MessageResponse> {
    return this.messages.appendAiMessage(
      request,
      unpackCallerContext(metadata),
    );
  }

  listMessages(
    request: ListMessagesRequest,
    metadata?: Metadata,
  ): Promise<ListMessagesResponse> {
    return this.messages.listMessages(request, unpackCallerContext(metadata));
  }

  updateMessage(
    request: UpdateMessageRequest,
    metadata?: Metadata,
  ): Promise<MessageResponse> {
    return this.messages.updateMessage(request, unpackCallerContext(metadata));
  }

  redactMessage(
    request: RedactMessageRequest,
    metadata?: Metadata,
  ): Promise<RedactMessageResponse> {
    return this.messages.redactMessage(request, unpackCallerContext(metadata));
  }

  /**
   * The PRESIGN step. Returns a URL rather than a stored row, because no row
   * exists until the bytes have actually landed — 10-storage-service.md §3.2.
   */
  uploadAttachment(
    request: UploadAttachmentRequest,
    metadata?: Metadata,
  ): Promise<PresignAttachmentResponse> {
    return this.messages.uploadAttachment(
      request,
      unpackCallerContext(metadata),
    );
  }

  confirmAttachment(
    request: ConfirmAttachmentRequest,
    metadata?: Metadata,
  ): Promise<AttachmentResponse> {
    return this.messages.confirmAttachment(
      request,
      unpackCallerContext(metadata),
    );
  }

  listAttachments(
    request: ListAttachmentsRequest,
    metadata?: Metadata,
  ): Promise<ListAttachmentsResponse> {
    return this.messages.listAttachments(
      request,
      unpackCallerContext(metadata),
    );
  }

  deleteAttachment(
    request: DeleteAttachmentRequest,
    metadata?: Metadata,
  ): Promise<DeleteAttachmentResponse> {
    return this.messages.deleteAttachment(
      request,
      unpackCallerContext(metadata),
    );
  }

  downloadAttachment(
    request: DownloadAttachmentRequest,
    metadata?: Metadata,
  ): Promise<DownloadAttachmentResponse> {
    return this.messages.downloadAttachment(
      request,
      unpackCallerContext(metadata),
    );
  }
}
