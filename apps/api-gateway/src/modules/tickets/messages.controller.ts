import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import {
  MessagesGrpcClient,
  PresignAttachmentDto,
} from './messages-grpc.client';
import {
  ConfirmAttachmentDto,
  CreateMessageDto,
  ListMessagesQueryDto,
  UpdateMessageDto,
  UploadAttachmentDto,
} from './dto/rest/message.dto';
import {
  AttachmentResponseDto,
  MessageResponseDto,
} from './dto/rest/message-response.dto';

/**
 * The ticket thread (api-endpoints-plan §2.2).
 *
 * **Almost nothing here is permission-gated, and that is deliberate.** The
 * thread is how an end user talks to support: gating reads or replies would
 * make the product's core interaction available only to staff. What is
 * restricted lives one layer down, where it can be decided per ROW rather than
 * per route —
 *
 *   - internal notes are removed from a non-agent's results in the SQL, so the
 *     same URL returns different rows to different callers
 *   - editing is bounded by a time window and by authorship
 *
 * Only redaction carries a route permission, because it is the one action that
 * is purely moderation.
 */
@Controller('tickets/:ticketId/messages')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class MessagesController {
  constructor(private readonly messagesGrpcClient: MessagesGrpcClient) {}

  @Get()
  list(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<PaginationResponseBase<MessageResponseDto>> {
    return this.messagesGrpcClient.list(ticketId, query, context);
  }

  /**
   * `isInternalNote` is NOT gated here.
   *
   * A route-level permission would close this endpoint to end users, who post
   * ordinary replies through it. The note flag is checked in ticket-service
   * instead — one field refused, rather than the whole conversation.
   */
  @Post()
  @ResponseMessage('Message posted')
  create(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: CreateMessageDto,
  ): Promise<MessageResponseDto> {
    return this.messagesGrpcClient.create(ticketId, dto, context);
  }

  @Patch(':messageId')
  @ResponseMessage('Message updated')
  update(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: UpdateMessageDto,
  ): Promise<MessageResponseDto> {
    return this.messagesGrpcClient.update(ticketId, messageId, dto, context);
  }

  /**
   * 200 with the message, not 204.
   *
   * Redaction keeps the row — the placeholder and the `redactedAt` stamp are
   * what let a client re-render that position in the thread. A 204 would tell
   * it the message was gone, and a thread that silently loses a turn reads as
   * though the conversation never had it.
   */
  @Delete(':messageId')
  @RequirePermission('ticket.message.moderate')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Message redacted')
  redact(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<MessageResponseDto> {
    return this.messagesGrpcClient.redact(ticketId, messageId, context);
  }

  // -------------------------------------------------------------- attachments

  /**
   * Presign — 10-storage-service.md §3.2.
   *
   * Returns a URL the CLIENT PUTs the bytes to directly. The per-message cap is
   * enforced in ticket-service BEFORE anything is signed, so a caller already
   * at the cap never receives a usable URL for a sixth file.
   *
   * 200, not 201: nothing has been created yet. A 201 would tell a client the
   * attachment existed when all it has is permission to make one.
   */
  @Post(':messageId/attachments/upload-url')
  @HttpCode(HttpStatus.OK)
  presignAttachment(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: UploadAttachmentDto,
  ): Promise<PresignAttachmentDto> {
    return this.messagesGrpcClient.presignAttachment(
      ticketId,
      messageId,
      dto,
      context,
    );
  }

  @Post(':messageId/attachments/confirm')
  @ResponseMessage('Attachment added')
  confirmAttachment(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: ConfirmAttachmentDto,
  ): Promise<AttachmentResponseDto> {
    return this.messagesGrpcClient.confirmAttachment(
      ticketId,
      messageId,
      dto,
      context,
    );
  }

  @Get(':messageId/attachments')
  listAttachments(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<AttachmentResponseDto[]> {
    return this.messagesGrpcClient.listAttachments(
      ticketId,
      messageId,
      context,
    );
  }
}
