import {
  Body,
  Controller,
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsGrpcClient } from './notifications-grpc.client';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
import {
  ListNotificationsQueryDto,
  MarkManyReadDto,
  UpdatePreferenceDto,
} from './dto/rest/notification.dto';
import {
  MarkReadResponseDto,
  NotificationFeedResponseDto,
  PreferenceResponseDto,
  UnreadCountResponseDto,
} from './dto/rest/notification-response.dto';

/**
 * The personal inbox — api-endpoints-plan §4b, 18-doc §2.
 *
 * **Every route is SELF-scoped, and there is no `PermissionGuard`.** That is
 * not an omission: a permission would imply the existence of a caller who could
 * read someone else's feed, and there is none. The recipient is `ctx.sub`,
 * carried in gRPC metadata, and no request shape here can name a different one.
 *
 * **Prefix is `/notifications`, not `/users/me/notifications`** — the §8
 * ownership map routes by path prefix and `/users/*` belongs to auth-service. A
 * top-level prefix is what makes the owning service unambiguous from the route.
 *
 * **There is deliberately no `POST /notifications`.** Notifications are created
 * by NATS consumers, never by a client: an HTTP create endpoint would be a spam
 * vector into other users' inboxes and would bypass the `event_id` idempotency
 * that makes at-least-once delivery safe.
 */
@ApiTags('Notifications')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsGrpcClient: NotificationsGrpcClient,
  ) {}

  @ApiOperation({
    summary:
      'Cursor-paginated feed (?type=&unreadOnly=false&cursor=), 20/page, newest first',
  })
  @ApiWrappedResponse(NotificationFeedResponseDto)
  @ApiFilterErrors(['401'])
  @Get()
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationFeedResponseDto> {
    return this.notificationsGrpcClient.list(query, context);
  }

  /**
   * Declared BEFORE any `:id` route.
   *
   * Nest matches in declaration order, and `:id` would swallow `unread-count`
   * and `preferences` — turning them into a `ParseUUIDPipe` 400 that reads as a
   * client bug rather than a routing mistake. The same hazard `bulk/status`,
   * `by-number` and `documents/storage` each hit in turn.
   */
  @ApiOperation({ summary: 'Integer count of unread + non-archived' })
  @ApiWrappedResponse(UnreadCountResponseDto)
  @ApiFilterErrors(['401'])
  @Get('unread-count')
  unreadCount(
    @CurrentUser() context: RequestContext,
  ): Promise<UnreadCountResponseDto> {
    return this.notificationsGrpcClient.unreadCount(context);
  }

  @ApiOperation({
    summary:
      "Full resolved catalogue per (type, channel) — exact match, else ('*', channel), else the hard-coded default",
  })
  @ApiWrappedResponse(PreferenceResponseDto, { isArray: true })
  @ApiFilterErrors(['401'])
  @Get('preferences')
  listPreferences(
    @CurrentUser() context: RequestContext,
  ): Promise<PreferenceResponseDto[]> {
    return this.notificationsGrpcClient.listPreferences(context);
  }

  /** Upsert on `(user_id, type, channel)` — never a duplicate-row insert. */
  @ApiOperation({ summary: 'Update preference' })
  @ApiWrappedResponse(PreferenceResponseDto)
  @ApiFilterErrors(['400', '401'])
  @Patch('preferences')
  updatePreference(
    @CurrentUser() context: RequestContext,
    @Body() dto: UpdatePreferenceDto,
  ): Promise<PreferenceResponseDto> {
    return this.notificationsGrpcClient.updatePreference(dto, context);
  }

  /**
   * Bulk read. Also before `:id`, and a POST to the collection root.
   *
   * `{ resourceType, resourceId }` is the form that makes the feature usable:
   * opening ticket #1042 clears all twelve of its notifications in one call.
   */
  @ApiOperation({ summary: 'Mark many read' })
  @ApiWrappedResponse(MarkReadResponseDto)
  @ApiFilterErrors(['400', '401'])
  @Post('read')
  @HttpCode(HttpStatus.OK)
  markManyRead(
    @CurrentUser() context: RequestContext,
    @Body() dto: MarkManyReadDto,
  ): Promise<MarkReadResponseDto> {
    return this.notificationsGrpcClient.markManyRead(dto, context);
  }

  /**
   * 200 and idempotent — re-reading an already-read row is not a conflict.
   *
   * A double-click must not produce a 409, and a client that retries on a flaky
   * connection must not have to distinguish "already read" from "failed".
   */
  @ApiOperation({ summary: 'Mark read' })
  @ApiWrappedResponse(MarkReadResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MarkReadResponseDto> {
    return this.notificationsGrpcClient.markRead(id, context);
  }

  /**
   * Dismiss — hidden from the default feed, **not deleted**.
   *
   * `expires_at` and the pruning job own deletion. A user who archives
   * something must still be able to find it with `includeArchived`.
   */
  @ApiOperation({ summary: 'Archive' })
  @ApiWrappedResponse(MarkReadResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MarkReadResponseDto> {
    return this.notificationsGrpcClient.archive(id, context);
  }
}
