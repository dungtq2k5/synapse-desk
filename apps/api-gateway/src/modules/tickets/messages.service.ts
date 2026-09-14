import { Injectable } from '@nestjs/common';
import { AnswerStatus, RequestContext } from '@synapsedesk/common';
import {
  DraftCitation,
  GetAiAttachmentsResponse,
  toPageRequest,
  toProtoMessageAnswerStatus,
} from '@synapsedesk/grpc-proto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { MessagesGrpcClient } from './messages-grpc.client';
import {
  toAttachmentResponseDto,
  toAttachmentResponseDtos,
  toCreateMessageResponseDto,
  toDownloadAttachmentResponseDto,
  toMessagePageDto,
  toMessageResponseDto,
  toPresignAttachmentResponseDto,
} from './message.mapper';
import {
  AttachmentResponseDto,
  CreateMessageResponseDto,
  DownloadAttachmentResponseDto,
  MessageResponseDto,
  PresignAttachmentResponseDto,
} from './dto/rest/message-response.dto';
import {
  ConfirmAttachmentDto,
  CreateMessageDto,
  ListMessagesQueryDto,
  UpdateMessageDto,
  UploadAttachmentDto,
} from './dto/rest/message.dto';

/** The gateway's message surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class MessagesService {
  constructor(private readonly messagesGrpcClient: MessagesGrpcClient) {}

  async list(
    ticketId: string,
    query: ListMessagesQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<MessageResponseDto>> {
    return toMessagePageDto(
      await this.messagesGrpcClient.list(
        { ticketId, page: toPageRequest(query) },
        context,
      ),
    );
  }

  /**
   * @param clientMessageId The sender's own id, for idempotency. An argument
   * rather than a DTO field because it belongs to the WEBSOCKET transport —
   * HTTP clients do not re-emit unacked requests on reconnect.
   */
  async create(
    ticketId: string,
    dto: CreateMessageDto,
    context: RequestContext,
    clientMessageId?: string,
  ): Promise<CreateMessageResponseDto> {
    return toCreateMessageResponseDto(
      await this.messagesGrpcClient.create(
        {
          ticketId,
          content: dto.content,
          isInternalNote: dto.isInternalNote,
          invokeAi: dto.invokeAi,
          clientMessageId,
          attachments: dto.attachments,
          // Closes the acceptance loop — not sending it made every accepted
          // draft look discarded.
          generatedFromId: dto.generatedFromId,
        },
        context,
      ),
    );
  }

  /**
   * Persists a streamed AI answer.
   *
   * @param answerStatus What the generation concluded, as the DOMAIN enum.
   */
  async appendAi(
    ticketId: string,
    content: string,
    generationId: string | undefined,
    context: RequestContext,
    answerStatus: AnswerStatus | null,
    citations?: DraftCitation[],
  ): Promise<MessageResponseDto> {
    return toMessageResponseDto(
      await this.messagesGrpcClient.appendAi(
        {
          ticketId,
          content,
          generationId,
          answerStatus: toProtoMessageAnswerStatus(answerStatus),
          // Wrapped only when given: an omitted argument leaves the column
          // NULL, where `{ items: [] }` would record "cited nothing".
          citations: citations ? { items: citations } : undefined,
        },
        context,
      ),
    );
  }

  async excludeFromAiContext(
    ticketId: string,
    messageId: string,
    context: RequestContext,
  ): Promise<MessageResponseDto> {
    return toMessageResponseDto(
      await this.messagesGrpcClient.excludeFromAiContext(
        ticketId,
        messageId,
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
    return toMessageResponseDto(
      await this.messagesGrpcClient.update(
        { ticketId, messageId, content: dto.content },
        context,
      ),
    );
  }

  /**
   * Returns the message rather than nothing: redaction KEEPS the row, and the
   * client needs the placeholder and `redactedAt` to re-render that position.
   */
  async redact(
    ticketId: string,
    messageId: string,
    context: RequestContext,
  ): Promise<MessageResponseDto> {
    const { message } = await this.messagesGrpcClient.redact(
      ticketId,
      messageId,
      context,
    );

    return toMessageResponseDto(message!);
  }

  async presignAttachment(
    ticketId: string,
    messageId: string | undefined,
    dto: UploadAttachmentDto,
    context: RequestContext,
  ): Promise<PresignAttachmentResponseDto> {
    return toPresignAttachmentResponseDto(
      await this.messagesGrpcClient.presignAttachment(
        {
          ticketId,
          messageId,
          fileName: dto.fileName,
          fileSizeBytes: dto.fileSizeBytes,
          mimeType: dto.mimeType,
        },
        context,
      ),
    );
  }

  async confirmAttachment(
    ticketId: string,
    messageId: string,
    dto: ConfirmAttachmentDto,
    context: RequestContext,
  ): Promise<AttachmentResponseDto> {
    return toAttachmentResponseDto(
      await this.messagesGrpcClient.confirmAttachment(
        {
          ticketId,
          messageId,
          objectPath: dto.objectPath,
          fileName: dto.fileName,
        },
        context,
      ),
    );
  }

  async listAttachments(
    ticketId: string,
    messageId: string,
    context: RequestContext,
  ): Promise<AttachmentResponseDto[]> {
    return toAttachmentResponseDtos(
      await this.messagesGrpcClient.listAttachments(
        ticketId,
        messageId,
        context,
      ),
    );
  }

  deleteAttachment(
    attachmentId: string,
    context: RequestContext,
  ): Promise<void> {
    return this.messagesGrpcClient.deleteAttachment(attachmentId, context);
  }

  /**
   * The AI-eligible attachments of one message, as bytes.
   *
   * Returned raw rather than through a DTO: `parts` carries file BYTES straight
   * into a `ChatRequest`, and a response DTO would exist only to copy them.
   */
  aiAttachments(
    messageId: string,
    context: RequestContext,
  ): Promise<GetAiAttachmentsResponse> {
    return this.messagesGrpcClient.aiAttachments(messageId, context);
  }

  async downloadAttachment(
    attachmentId: string,
    context: RequestContext,
  ): Promise<DownloadAttachmentResponseDto> {
    return toDownloadAttachmentResponseDto(
      await this.messagesGrpcClient.downloadAttachment(attachmentId, context),
    );
  }
}
