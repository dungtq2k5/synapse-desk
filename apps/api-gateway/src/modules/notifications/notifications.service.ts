import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { NotificationsGrpcClient } from './notifications-grpc.client';
import {
  toListNotificationsRequest,
  toMarkReadRequest,
  toNotificationFeedResponseDto,
  toPreferenceResponseDto,
  toPreferenceResponseDtos,
  toUpdatePreferenceRequest,
} from './notification.mapper';
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

/** The gateway's notification surface. Returns REST DTOs; the wire stays in the client. */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsGrpcClient: NotificationsGrpcClient,
  ) {}

  async list(
    query: ListNotificationsQueryDto,
    context: RequestContext,
  ): Promise<NotificationFeedResponseDto> {
    return toNotificationFeedResponseDto(
      await this.notificationsGrpcClient.list(
        toListNotificationsRequest(query),
        context,
      ),
    );
  }

  unreadCount(context: RequestContext): Promise<UnreadCountResponseDto> {
    return this.notificationsGrpcClient.unreadCount(context);
  }

  markRead(id: string, context: RequestContext): Promise<MarkReadResponseDto> {
    return this.notificationsGrpcClient.markRead(id, context);
  }

  archive(id: string, context: RequestContext): Promise<MarkReadResponseDto> {
    return this.notificationsGrpcClient.archive(id, context);
  }

  markManyRead(
    dto: MarkManyReadDto,
    context: RequestContext,
  ): Promise<MarkReadResponseDto> {
    return this.notificationsGrpcClient.markManyRead(
      toMarkReadRequest(dto),
      context,
    );
  }

  async listPreferences(
    context: RequestContext,
  ): Promise<PreferenceResponseDto[]> {
    return toPreferenceResponseDtos(
      await this.notificationsGrpcClient.listPreferences(context),
    );
  }

  async updatePreference(
    dto: UpdatePreferenceDto,
    context: RequestContext,
  ): Promise<PreferenceResponseDto> {
    return toPreferenceResponseDto(
      await this.notificationsGrpcClient.updatePreference(
        toUpdatePreferenceRequest(dto),
        context,
      ),
    );
  }
}
