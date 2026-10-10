import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  MESSAGE_SERVICE_NAME,
  MessageServiceClient,
  AppendAiMessageRequest,
  AttachmentResponse,
  ConfirmAttachmentRequest,
  CreateMessageRequest,
  CreateMessageResponse,
  DownloadAttachmentResponse,
  GetAiAttachmentsResponse,
  ListAttachmentsResponse,
  ListMessagesRequest,
  ListMessagesResponse,
  MessageResponse,
  PresignAttachmentResponse,
  RedactMessageResponse,
  TICKET_GRPC_CLIENT,
  UpdateMessageRequest,
  UploadAttachmentRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

@Injectable()
export class MessagesGrpcClient extends BaseGrpcClient implements OnModuleInit {
  protected readonly serviceName = 'ticket-service';

  private messageGrpcService!: MessageServiceClient;

  constructor(@Inject(TICKET_GRPC_CLIENT) private readonly client: ClientGrpc) {
    super();
  }

  onModuleInit() {
    this.messageGrpcService =
      this.client.getService<MessageServiceClient>(MESSAGE_SERVICE_NAME);
  }

  list(
    request: ListMessagesRequest,
    context: RequestContext,
  ): Promise<ListMessagesResponse> {
    return this.call(
      (metadata) => this.messageGrpcService.listMessages(request, metadata),
      context,
    );
  }

  create(
    request: CreateMessageRequest,
    context: RequestContext,
  ): Promise<CreateMessageResponse> {
    return this.call(
      (metadata) => this.messageGrpcService.createMessage(request, metadata),
      context,
    );
  }

  /**
   * Persists a STREAMED AI answer, write #2.
   *
   * Not reachable from any route — the only caller is `AiStreamService`, with
   * content that came from rag-service's `Chat` stream.
   */
  appendAi(
    request: AppendAiMessageRequest,
    context: RequestContext,
  ): Promise<MessageResponse> {
    return this.call(
      (metadata) => this.messageGrpcService.appendAiMessage(request, metadata),
      context,
    );
  }

  /**
   * Marks a message as unusable for AI context.
   *
   * The row stays visible in the thread; what changes is that no transcript
   * builder hands it to a model again.
   */
  excludeFromAiContext(
    ticketId: string,
    messageId: string,
    context: RequestContext,
  ): Promise<MessageResponse> {
    return this.call(
      (metadata) =>
        this.messageGrpcService.excludeFromAiContext(
          { ticketId, messageId },
          metadata,
        ),
      context,
    );
  }

  update(
    request: UpdateMessageRequest,
    context: RequestContext,
  ): Promise<MessageResponse> {
    return this.call(
      (metadata) => this.messageGrpcService.updateMessage(request, metadata),
      context,
    );
  }

  redact(
    ticketId: string,
    messageId: string,
    context: RequestContext,
  ): Promise<RedactMessageResponse> {
    return this.call(
      (metadata) =>
        this.messageGrpcService.redactMessage(
          { ticketId, messageId },
          metadata,
        ),
      context,
    );
  }

  /** The PRESIGN step — returns a URL, not a row. */
  presignAttachment(
    request: UploadAttachmentRequest,
    context: RequestContext,
  ): Promise<PresignAttachmentResponse> {
    return this.call(
      (metadata) => this.messageGrpcService.uploadAttachment(request, metadata),
      context,
    );
  }

  confirmAttachment(
    request: ConfirmAttachmentRequest,
    context: RequestContext,
  ): Promise<AttachmentResponse> {
    return this.call(
      (metadata) =>
        this.messageGrpcService.confirmAttachment(request, metadata),
      context,
    );
  }

  listAttachments(
    ticketId: string,
    messageId: string,
    context: RequestContext,
  ): Promise<ListAttachmentsResponse> {
    return this.call(
      (metadata) =>
        this.messageGrpcService.listAttachments(
          { ticketId, messageId },
          metadata,
        ),
      context,
    );
  }

  async deleteAttachment(
    attachmentId: string,
    context: RequestContext,
  ): Promise<void> {
    await this.call(
      (metadata) =>
        this.messageGrpcService.deleteAttachment({ attachmentId }, metadata),
      context,
    );
  }

  /**
   * The AI-eligible attachments of one message, as bytes.
   *
   * Asked for rather than fetched here: this gateway has no storage client, and
   * ticket-service owns the eligibility rule.
   */
  aiAttachments(
    messageId: string,
    context: RequestContext,
  ): Promise<GetAiAttachmentsResponse> {
    return this.call(
      (metadata) =>
        this.messageGrpcService.getAiAttachments({ messageId }, metadata),
      context,
    );
  }

  downloadAttachment(
    attachmentId: string,
    context: RequestContext,
  ): Promise<DownloadAttachmentResponse> {
    return this.call(
      (metadata) =>
        this.messageGrpcService.downloadAttachment({ attachmentId }, metadata),
      context,
    );
  }
}
