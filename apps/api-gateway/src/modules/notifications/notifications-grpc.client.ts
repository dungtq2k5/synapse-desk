import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  fromTimestamp,
  NOTIFICATION_GRPC_CLIENT,
  NOTIFICATION_SERVICE_NAME,
  NotificationResponse,
  NotificationServiceClient,
  requireTimestamp,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';
import {
  ListNotificationsQueryDto,
  MarkManyReadDto,
  UpdatePreferenceDto,
} from './dto/rest/notification.dto';
import {
  MarkReadResponseDto,
  NotificationFeedResponseDto,
  NotificationResponseDto,
  PreferenceResponseDto,
  UnreadCountResponseDto,
} from './dto/rest/notification-response.dto';

@Injectable()
export class NotificationsGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'notification-service';

  private notificationGrpcService!: NotificationServiceClient;

  constructor(
    @Inject(NOTIFICATION_GRPC_CLIENT) private readonly client: ClientGrpc,
  ) {
    super();
  }

  onModuleInit() {
    this.notificationGrpcService =
      this.client.getService<NotificationServiceClient>(
        NOTIFICATION_SERVICE_NAME,
      );
  }

  async list(
    query: ListNotificationsQueryDto,
    context: RequestContext,
  ): Promise<NotificationFeedResponseDto> {
    const response = await this.call(
      (metadata) =>
        this.notificationGrpcService.listNotifications(
          {
            type: query.type,
            unreadOnly: query.unreadOnly ?? false,
            includeArchived: query.includeArchived ?? false,
            cursor: query.cursor,
            limit: query.limit ?? 20,
          },
          metadata,
        ),
      context,
    );

    return {
      items: response.items.map(toNotificationDto),
      // `?? null`: proto3 `optional` arrives as undefined, and a client
      // checking `nextCursor !== null` would loop forever on undefined.
      nextCursor: response.nextCursor ?? null,
      hasMore: response.hasMore,
    };
  }

  async unreadCount(context: RequestContext): Promise<UnreadCountResponseDto> {
    const response = await this.call(
      // The request message is shared with the feed and every field is
      // irrelevant here — the recipient comes from metadata. Reusing it beats
      // an empty message that would then need its own name.
      (metadata) =>
        this.notificationGrpcService.getUnreadCount(
          { unreadOnly: true, includeArchived: false, limit: 0 },
          metadata,
        ),
      context,
    );

    return { count: response.count };
  }

  async markRead(
    id: string,
    context: RequestContext,
  ): Promise<MarkReadResponseDto> {
    return this.call(
      (metadata) => this.notificationGrpcService.markRead({ id }, metadata),
      context,
    );
  }

  async archive(
    id: string,
    context: RequestContext,
  ): Promise<MarkReadResponseDto> {
    return this.call(
      (metadata) => this.notificationGrpcService.archive({ id }, metadata),
      context,
    );
  }

  async markManyRead(
    dto: MarkManyReadDto,
    context: RequestContext,
  ): Promise<MarkReadResponseDto> {
    return this.call(
      (metadata) =>
        this.notificationGrpcService.markManyRead(
          {
            ids: dto.ids ?? [],
            resourceType: dto.resourceType,
            resourceId: dto.resourceId,
          },
          metadata,
        ),
      context,
    );
  }

  async listPreferences(
    context: RequestContext,
  ): Promise<PreferenceResponseDto[]> {
    const response = await this.call(
      (metadata) => this.notificationGrpcService.listPreferences({}, metadata),
      context,
    );

    return response.items;
  }

  async updatePreference(
    dto: UpdatePreferenceDto,
    context: RequestContext,
  ): Promise<PreferenceResponseDto> {
    return this.call(
      (metadata) =>
        this.notificationGrpcService.updatePreference(
          {
            type: dto.type,
            channel: dto.channel,
            isEnabled: dto.isEnabled,
            digest: dto.digest,
          },
          metadata,
        ),
      context,
    );
  }
}

/**
 * Wire → REST, and `data` is parsed back into an object here.
 *
 * It crosses gRPC as a JSON string because proto3 has no `map<string, any>`;
 * a client should never see the encoding the transport needed. Parsing is
 * guarded because the alternative — a malformed payload failing the whole feed
 * — would take out every notification for one bad row.
 */
function toNotificationDto(
  notification: NotificationResponse,
): NotificationResponseDto {
  return {
    id: notification.id,
    organizationId: notification.organizationId,
    type: notification.type,
    priority: notification.priority,
    title: notification.title,
    body: notification.body ?? null,
    data: parseData(notification.data),
    actionUrl: notification.actionUrl ?? null,
    actorId: notification.actorId ?? null,
    resourceType: notification.resourceType ?? null,
    resourceId: notification.resourceId ?? null,
    groupKey: notification.groupKey ?? null,
    groupCount: notification.groupCount,
    readAt: fromTimestamp(notification.readAt) ?? null,
    archivedAt: fromTimestamp(notification.archivedAt) ?? null,
    createdAt: requireTimestamp(notification.createdAt, 'createdAt'),
  };
}

function parseData(raw: string): Record<string, unknown> {
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
