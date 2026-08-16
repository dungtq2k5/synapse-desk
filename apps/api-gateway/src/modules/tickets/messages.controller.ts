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
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
  Paginated,
} from '../../common/decorators/api-response.decorator';
import { MessagesGrpcClient } from './messages-grpc.client';
import {
  ConfirmAttachmentDto,
  CreateMessageDto,
  ListMessagesQueryDto,
  UpdateMessageDto,
  UploadAttachmentDto,
} from './dto/rest/message.dto';
import {
  AttachmentResponseDto,
  CreateMessageResponseDto,
  MessageResponseDto,
  PresignAttachmentResponseDto,
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
@ApiTags('Messages')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('tickets/:ticketId/messages')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class MessagesController {
  constructor(private readonly messagesGrpcClient: MessagesGrpcClient) {}

  @ApiOperation({
    summary: 'Chronological thread, cursor-paginated (?before=&limit=)',
  })
  @ApiWrappedResponse(Paginated(MessageResponseDto))
  @ApiFilterErrors(['400', '401', '404'])
  @Get()
  list(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<PaginationResponseDto<MessageResponseDto>> {
    return this.messagesGrpcClient.list(ticketId, query, context);
  }

  /**
   * `isInternalNote` is NOT gated here.
   *
   * A route-level permission would close this endpoint to end users, who post
   * ordinary replies through it. The note flag is checked in ticket-service
   * instead — one field refused, rather than the whole conversation.
   *
   * **The response shape CHANGED, unversioned, and that was a choice** —
   * This returned a bare message; it now returns
   * `{ message, skippedAttachments }`, because a create can partially succeed
   * and a caller has to be told which files did not confirm.
   *
   * `enableVersioning` is not switched on anywhere in this gateway, so there is
   * no `@Version` to hang an old shape from — adding the mechanism for one
   * endpoint would mean versioning every route to keep the surface coherent.
   * With no client shipped, breaking it now costs nothing and carrying two
   * shapes forever costs something. **Recorded here rather than left to be
   * discovered by the first client**, which is the whole point of writing it
   * down: the next breaking change does not get to make this call by default.
   */
  @ApiOperation({ summary: 'Create' })
  @ApiWrappedResponse(CreateMessageResponseDto, { status: HttpStatus.CREATED })
  @ApiFilterErrors(['400', '401', '404'])
  @Post()
  @ResponseMessage('Message posted')
  create(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: CreateMessageDto,
  ): Promise<CreateMessageResponseDto> {
    return this.messagesGrpcClient.create(ticketId, dto, context);
  }

  @ApiOperation({
    summary:
      'Edit own message inside a short window; internal notes editable by agents',
  })
  @ApiWrappedResponse(MessageResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
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
  @ApiOperation({
    summary:
      'Redact a message (content replaced, row retained for the audit timeline)',
  })
  @ApiWrappedResponse(MessageResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
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
   * The same presign, for a message that does NOT exist yet
   *
   * **This route is what makes a first-turn attachment readable.** Its sibling
   * below is nested under `:messageId`, so a client could only upload after
   * posting — while `invokeAi` runs during the post. The screenshot was stored
   * a moment after the answer that needed it.
   *
   * The object paths this returns are handed to `POST /tickets/:id/messages` in
   * `attachments`, which confirms each one and binds it as the message is
   * written. No cap is checked here because there is no message to count
   * against; create enforces it over the list it is given, and a presigned URL
   * that is never bound costs an orphaned object — a class that already exists,
   * since presign-then-never-confirm has always produced them.
   */
  @ApiOperation({
    summary:
      'Presign an upload for a message not yet created: { fileName, fileSizeBytes, mimeType } → { uploadUrl, objectPath, expiresAt }',
  })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401', '404'])
  @Post('attachments/upload-url')
  @HttpCode(HttpStatus.OK)
  presignNewAttachment(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: UploadAttachmentDto,
  ): Promise<PresignAttachmentResponseDto> {
    return this.messagesGrpcClient.presignAttachment(
      ticketId,
      undefined,
      dto,
      context,
    );
  }

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
  @ApiOperation({
    summary:
      'Presign a direct-to-Firebase-Storage upload: { contentType, sizeBytes } → { uploadUrl, objectPath, expiresAt }',
  })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401', '404'])
  @Post(':messageId/attachments/upload-url')
  @HttpCode(HttpStatus.OK)
  presignAttachment(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: UploadAttachmentDto,
  ): Promise<PresignAttachmentResponseDto> {
    return this.messagesGrpcClient.presignAttachment(
      ticketId,
      messageId,
      dto,
      context,
    );
  }

  @ApiOperation({
    summary: '{ objectPath } — confirms, writes the message_attachments row',
  })
  @ApiWrappedResponse(AttachmentResponseDto, { status: HttpStatus.CREATED })
  @ApiFilterErrors(['400', '401', '404'])
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

  @ApiOperation({ summary: 'List attachments' })
  @ApiWrappedResponse(AttachmentResponseDto, { isArray: true })
  @ApiFilterErrors(['400', '401', '404'])
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
