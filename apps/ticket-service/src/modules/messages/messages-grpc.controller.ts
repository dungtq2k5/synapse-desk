import { Controller } from '@nestjs/common';
import type { Metadata } from '@grpc/grpc-js';
import {
  AppendAiMessageRequest,
  AttachmentResponse,
  ConfirmAttachmentRequest,
  CreateMessageRequest,
  CreateMessageResponse,
  ExcludeFromAiContextRequest,
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
  GetAiAttachmentsRequest,
  GetAiAttachmentsResponse,
} from '@synapsedesk/grpc-proto';
import { MessagesService } from './messages.service';
import { AiAttachmentService } from '../ai-attachments/ai-attachment.service';

@Controller()
@MessageServiceControllerMethods()
export class MessagesGrpcController implements MessageServiceController {
  constructor(
    private readonly messages: MessagesService,
    private readonly aiAttachments: AiAttachmentService,
  ) {}

  createMessage(
    request: CreateMessageRequest,
    metadata?: Metadata,
  ): Promise<CreateMessageResponse> {
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

  excludeFromAiContext(
    request: ExcludeFromAiContextRequest,
    metadata?: Metadata,
  ): Promise<MessageResponse> {
    return this.messages.excludeFromAiContext(
      request,
      unpackCallerContext(metadata),
    );
  }

  redactMessage(
    request: RedactMessageRequest,
    metadata?: Metadata,
  ): Promise<RedactMessageResponse> {
    return this.messages.redactMessage(request, unpackCallerContext(metadata));
  }

  /**
   * The PRESIGN step. Returns a URL rather than a stored row, because no row
   * exists until the bytes have actually landed.
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

  /**
   * The gateway's route to attachment bytes.
   *
   * It has no storage client of its own, and this service already does the
   * identical filter-and-fetch for its two `Draft` call sites. One
   * implementation of the eligibility rule beats three.
   */
  getAiAttachments(
    request: GetAiAttachmentsRequest,
    metadata?: Metadata,
  ): Promise<GetAiAttachmentsResponse> {
    return this.aiAttachments.forMessage(
      request.messageId,
      unpackCallerContext(metadata),
    );
  }
}
