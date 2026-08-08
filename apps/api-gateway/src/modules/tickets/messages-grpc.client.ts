import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  MESSAGE_SERVICE_NAME,
  MessageServiceClient,
  requireTimestamp,
  TICKET_GRPC_CLIENT,
  toPageRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { toPaginationMeta } from '../../common/mappers/pagination.mapper';
import { toAttachmentDto, toMessageDto } from './message.mapper';
import {
  AttachmentResponseDto,
  MessageResponseDto,
} from './dto/rest/message-response.dto';
import {
  ConfirmAttachmentDto,
  CreateMessageDto,
  ListMessagesQueryDto,
  UpdateMessageDto,
  UploadAttachmentDto,
} from './dto/rest/message.dto';

export type PresignAttachmentDto = {
  uploadUrl: string;
  objectPath: string;
  expiresAt: Date;
};

export type DownloadAttachmentDto = {
  downloadUrl: string;
  expiresAt: Date;
};

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

  async list(
    ticketId: string,
    query: ListMessagesQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseBase<MessageResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.messageGrpcService.listMessages(
          { ticketId, page: toPageRequest(query) },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toMessageDto),
      meta: toPaginationMeta(response.meta),
    };
  }

  async create(
    ticketId: string,
    dto: CreateMessageDto,
    context: RequestContext,
    /**
     * The sender's own id, for idempotency — 22-doc §2.3.
     *
     * Passed as an argument rather than added to `CreateMessageDto`, because it
     * belongs to the WEBSOCKET transport and not to the HTTP body. Putting it on
     * the DTO would advertise it on `POST /tickets/:id/messages`, where it has
     * no meaning — HTTP clients do not re-emit unacked requests on reconnect.
     */
    clientMessageId?: string,
  ): Promise<MessageResponseDto> {
    return toMessageDto(
      await this.call(
        (metadata) =>
          this.messageGrpcService.createMessage(
            {
              ticketId,
              content: dto.content,
              // `?? false`: proto3 booleans have no null, and an absent flag
              // means "an ordinary reply" rather than "unspecified".
              isInternalNote: dto.isInternalNote ?? false,
              invokeAi: dto.invokeAi ?? false,
              clientMessageId,
            },
            metadata,
          ),
        context,
      ),
    );
  }

  /**
   * Persists a STREAMED AI answer — 22-doc §5.1, write #2.
   *
   * **Not reachable from any route.** There is no DTO and no controller calling
   * this: the only caller is `AiStreamService`, with content that came from
   * rag-service's `Chat` stream. A body-driven path to it would let a customer
   * post arbitrary text attributed to the assistant in a thread they can read,
   * which is why the argument list is the raw fields rather than a DTO
   * something could bind a request to.
   */
  async appendAi(
    ticketId: string,
    content: string,
    generationId: string | undefined,
    context: RequestContext,
  ): Promise<MessageResponseDto> {
    return toMessageDto(
      await this.call(
        (metadata) =>
          this.messageGrpcService.appendAiMessage(
            { ticketId, content, generationId },
            metadata,
          ),
        context,
      ),
    );
  }

  async update(
    ticketId: string,
    messageId: string,
    dto: UpdateMessageDto,
    context: RequestContext,
  ): Promise<MessageResponseDto> {
    return toMessageDto(
      await this.call(
        (metadata) =>
          this.messageGrpcService.updateMessage(
            { ticketId, messageId, content: dto.content },
            metadata,
          ),
        context,
      ),
    );
  }

  /**
   * Returns the message rather than nothing, because redaction KEEPS the row —
   * the client needs the placeholder and the `redactedAt` stamp to re-render
   * that position in the thread rather than remove it.
   */
  async redact(
    ticketId: string,
    messageId: string,
    context: RequestContext,
  ): Promise<MessageResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.messageGrpcService.redactMessage(
          { ticketId, messageId },
          metadata,
        ),
      context,
    );

    return toMessageDto(response.message!);
  }

  /**
   * The PRESIGN step — returns a URL, not a row.
   *
   * No row exists until the bytes have landed, which is why the response shape
   * differs from every other create in this client.
   */
  async presignAttachment(
    ticketId: string,
    messageId: string,
    dto: UploadAttachmentDto,
    context: RequestContext,
  ): Promise<PresignAttachmentDto> {
    const response = await this.call(
      (metadata) =>
        this.messageGrpcService.uploadAttachment(
          {
            ticketId,
            messageId,
            fileName: dto.fileName,
            fileSizeBytes: dto.fileSizeBytes,
            mimeType: dto.mimeType,
          },
          metadata,
        ),
      context,
    );

    return {
      uploadUrl: response.uploadUrl,
      objectPath: response.objectPath,
      expiresAt: requireTimestamp(response.expiresAt, 'expiresAt'),
    };
  }

  async confirmAttachment(
    ticketId: string,
    messageId: string,
    dto: ConfirmAttachmentDto,
    context: RequestContext,
  ): Promise<AttachmentResponseDto> {
    return toAttachmentDto(
      await this.call(
        (metadata) =>
          this.messageGrpcService.confirmAttachment(
            {
              ticketId,
              messageId,
              objectPath: dto.objectPath,
              fileName: dto.fileName,
            },
            metadata,
          ),
        context,
      ),
    );
  }

  async listAttachments(
    ticketId: string,
    messageId: string,
    context: RequestContext,
  ): Promise<AttachmentResponseDto[]> {
    const response = await this.call(
      (metadata) =>
        this.messageGrpcService.listAttachments(
          { ticketId, messageId },
          metadata,
        ),
      context,
    );

    return response.items.map(toAttachmentDto);
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

  async downloadAttachment(
    attachmentId: string,
    context: RequestContext,
  ): Promise<DownloadAttachmentDto> {
    const response = await this.call(
      (metadata) =>
        this.messageGrpcService.downloadAttachment({ attachmentId }, metadata),
      context,
    );

    return {
      downloadUrl: response.downloadUrl,
      // `requireTimestamp`, not a hand-rolled epoch conversion: a signed URL
      // with no expiry is a contract violation, and defaulting it to 1970 would
      // hand the client a URL it believes is already dead.
      expiresAt: requireTimestamp(response.expiresAt, 'expiresAt'),
    };
  }
}
