import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  DownloadAttachmentDto,
  MessagesGrpcClient,
} from './messages-grpc.client';

/**
 * `/attachments/*` — a TOP-LEVEL prefix, not nested under its ticket.
 *
 * That is what api-endpoints-plan §2.2 specifies, and it is also the shape a
 * client needs: an attachment id is what appears in a rendered thread, and
 * requiring the ticket and message ids alongside it would mean every download
 * link carried three ids to say one thing.
 *
 * The cost is that the URL no longer states which ticket the file belongs to,
 * so the ACL cannot be inferred from the path — ticket-service resolves
 * attachment -> message -> ticket and applies the caller's visibility filter
 * there, BEFORE any signing call. That check is the only thing standing between
 * a guessed id and another tenant's file.
 */
@Controller('attachments')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AttachmentsController {
  constructor(private readonly messagesGrpcClient: MessagesGrpcClient) {}

  /**
   * Returns `{ downloadUrl, expiresAt }` rather than a 302.
   *
   * A redirect would work, but the JSON shape lets a client show an expiry and
   * re-request rather than discovering a dead link mid-download — and it keeps
   * the response envelope identical to every other endpoint.
   *
   */
  @Get(':id/download')
  download(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DownloadAttachmentDto> {
    return this.messagesGrpcClient.downloadAttachment(id, context);
  }

  /**
   * A HARD delete, plus an async object removal.
   *
   * Attachments have no independent soft-delete story — they follow their
   * message — so a "deleted" row that every listing had to filter would be a
   * filter waiting to be forgotten. The FILE goes through the same
   * at-most-once supersede event everything else uses.
   */
  @Delete(':id')
  @RequirePermission('ticket.message.moderate')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.messagesGrpcClient.deleteAttachment(id, context);
  }
}
