import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  MESSAGE_SERVICE_NAME,
  MessageServiceClient,
  requireField,
  requireProtoTimestamp,
  TICKET_GRPC_CLIENT,
  toPageRequest,
  GetAiAttachmentsResponse,
  toProtoMessageAnswerStatus,
} from '@synapsedesk/grpc-proto';
import { AnswerStatus, RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { toPaginationMetaDataResponseDto } from '../../common/mappers/pagination.mapper';
import {
  toAttachmentResponseDto,
  toMessageResponseDto,
} from './message.mapper';
import {
  AttachmentResponseDto,
  DownloadAttachmentResponseDto,
  CreateMessageResponseDto,
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
  ): Promise<PaginationResponseDto<MessageResponseDto>> {
    const response = await this.call(
      (metadata) =>
        this.messageGrpcService.listMessages(
          { ticketId, page: toPageRequest(query) },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toMessageResponseDto),
      meta: toPaginationMetaDataResponseDto(response.meta),
    };
  }

  async create(
    ticketId: string,
    dto: CreateMessageDto,
    context: RequestContext,
    /**
     * The sender's own id, for idempotency
     *
     * Passed as an argument rather than added to `CreateMessageDto`, because it
     * belongs to the WEBSOCKET transport and not to the HTTP body. Putting it on
     * the DTO would advertise it on `POST /tickets/:id/messages`, where it has
     * no meaning — HTTP clients do not re-emit unacked requests on reconnect.
     */
    clientMessageId?: string,
  ): Promise<CreateMessageResponseDto> {
    const response = await this.call(
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
            // Already-uploaded objects, bound as the message is written —
            // `?? []` because proto3 has no absent repeated field.
            attachments: dto.attachments ?? [],
            // **Closes the acceptance loop** Forwarded rather than
            // dropped: ticket-service has always read this field, and not
            // sending it is what made every accepted draft look discarded.
            generatedFromId: dto.generatedFromId,
          },
          metadata,
        ),
      context,
    );

    return {
      message: toMessageResponseDto(requireField(response.message, 'message')),
      // Names of files that did not confirm. Routinely non-empty for an honest
      // caller — a presign record lives ten minutes — so this is a normal
      // outcome to render, not an error path.
      skippedAttachments: response.skippedAttachments,
    };
  }

  /**
   * Persists a STREAMED AI answer, write #2.
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
    // ASK This `docblock` seems to be invalid
    /**
     * What the generation concluded, persisted on the row
     *
     * The gateway held this in the completion frame and dropped it on write, so
     * once the socket closed a thread could not tell a refusal from an answer.
     *
     * The DOMAIN enum, not the wire one and no longer a bare `string`. The
     * caller is `ai-stream.service.ts`, which reads rag's numeric enum off the
     * stream — it now converts once, through `fromProtoRagAnswerStatus`, rather
     * than rebuilding the name here with a reverse lookup and a `.replace()`.
     */
    answerStatus: AnswerStatus | null,
  ): Promise<MessageResponseDto> {
    return toMessageResponseDto(
      await this.call(
        (metadata) =>
          this.messageGrpcService.appendAiMessage(
            {
              ticketId,
              content,
              generationId,
              answerStatus: toProtoMessageAnswerStatus(answerStatus),
            },
            metadata,
          ),
        context,
      ),
    );
  }

  /**
   * Marks a message as unusable for AI context
   *
   * Called on the refusal path only, by the service that holds the id of the
   * message that was just refused. The row stays visible in the thread; what
   * changes is that no transcript builder hands it to a model again.
   */
  async excludeFromAiContext(
    ticketId: string,
    messageId: string,
    context: RequestContext,
  ): Promise<MessageResponseDto> {
    return toMessageResponseDto(
      await this.call(
        (metadata) =>
          this.messageGrpcService.excludeFromAiContext(
            { ticketId, messageId },
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
    return toMessageResponseDto(
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

    return toMessageResponseDto(response.message!);
  }

  /**
   * The PRESIGN step — returns a URL, not a row.
   *
   * No row exists until the bytes have landed, which is why the response shape
   * differs from every other create in this client.
   */
  async presignAttachment(
    ticketId: string,
    /** Absent when the message does not exist yet */
    messageId: string | undefined,
    dto: UploadAttachmentDto,
    context: RequestContext,
  ): Promise<PresignAttachmentResponseDto> {
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
      expiresAt: requireProtoTimestamp(response.expiresAt, 'expiresAt'),
    };
  }

  async confirmAttachment(
    ticketId: string,
    messageId: string,
    dto: ConfirmAttachmentDto,
    context: RequestContext,
  ): Promise<AttachmentResponseDto> {
    return toAttachmentResponseDto(
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

    return response.items.map(toAttachmentResponseDto);
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
   * The AI-eligible attachments of one message, as bytes
   *
   * **Asked for rather than fetched here.** This gateway has no storage client,
   * and ticket-service already runs the identical filter-and-fetch for its two
   * `Draft` call sites — one implementation of the eligibility rule, in the
   * service that owns `message_attachments`.
   *
   * `parts` is returned raw rather than through a DTO mapper: it carries file
   * BYTES straight into a `ChatRequest`, and a response DTO would exist only to
   * copy them.
   */
  async aiAttachments(
    messageId: string,
    context: RequestContext,
  ): Promise<GetAiAttachmentsResponse> {
    return this.call(
      (metadata) =>
        this.messageGrpcService.getAiAttachments({ messageId }, metadata),
      context,
    );
  }

  async downloadAttachment(
    attachmentId: string,
    context: RequestContext,
  ): Promise<DownloadAttachmentResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.messageGrpcService.downloadAttachment({ attachmentId }, metadata),
      context,
    );

    return {
      downloadUrl: response.downloadUrl,
      // `requireProtoTimestamp`, not a hand-rolled epoch conversion: a signed URL
      // with no expiry is a contract violation, and defaulting it to 1970 would
      // hand the client a URL it believes is already dead.
      expiresAt: requireProtoTimestamp(response.expiresAt, 'expiresAt'),
    };
  }
}
