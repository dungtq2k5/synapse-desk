import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  DeviceTokenResponse,
  ForgetDeviceResponse,
  ListDevicesResponse,
  RegisterDeviceRequest,
  ListNotificationsRequest,
  ListNotificationsResponse,
  ListPreferencesResponse,
  MarkReadRequest,
  MarkReadResponse,
  NOTIFICATION_GRPC_CLIENT,
  NOTIFICATION_SERVICE_NAME,
  NotificationServiceClient,
  PreferenceResponse,
  UnreadCountResponse,
  UpdatePreferenceRequest,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

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

  list(
    request: ListNotificationsRequest,
    context: RequestContext,
  ): Promise<ListNotificationsResponse> {
    return this.call(
      (metadata) =>
        this.notificationGrpcService.listNotifications(request, metadata),
      context,
    );
  }

  /**
   * Reuses the feed's request message — the recipient comes from metadata, so
   * every field on it is irrelevant here.
   */
  unreadCount(context: RequestContext): Promise<UnreadCountResponse> {
    return this.call(
      (metadata) =>
        this.notificationGrpcService.getUnreadCount(
          { unreadOnly: true, includeArchived: false, limit: 0 },
          metadata,
        ),
      context,
    );
  }

  markRead(id: string, context: RequestContext): Promise<MarkReadResponse> {
    return this.call(
      (metadata) => this.notificationGrpcService.markRead({ id }, metadata),
      context,
    );
  }

  archive(id: string, context: RequestContext): Promise<MarkReadResponse> {
    return this.call(
      (metadata) => this.notificationGrpcService.archive({ id }, metadata),
      context,
    );
  }

  markManyRead(
    request: MarkReadRequest,
    context: RequestContext,
  ): Promise<MarkReadResponse> {
    return this.call(
      (metadata) =>
        this.notificationGrpcService.markManyRead(request, metadata),
      context,
    );
  }

  listPreferences(context: RequestContext): Promise<ListPreferencesResponse> {
    return this.call(
      (metadata) => this.notificationGrpcService.listPreferences({}, metadata),
      context,
    );
  }

  updatePreference(
    request: UpdatePreferenceRequest,
    context: RequestContext,
  ): Promise<PreferenceResponse> {
    return this.call(
      (metadata) =>
        this.notificationGrpcService.updatePreference(request, metadata),
      context,
    );
  }

  registerDevice(
    request: RegisterDeviceRequest,
    context: RequestContext,
  ): Promise<DeviceTokenResponse> {
    return this.call(
      (metadata) =>
        this.notificationGrpcService.registerDevice(request, metadata),
      context,
    );
  }

  listDevices(context: RequestContext): Promise<ListDevicesResponse> {
    return this.call(
      (metadata) => this.notificationGrpcService.listDevices({}, metadata),
      context,
    );
  }

  forgetDevice(
    id: string,
    context: RequestContext,
  ): Promise<ForgetDeviceResponse> {
    return this.call(
      (metadata) => this.notificationGrpcService.forgetDevice({ id }, metadata),
      context,
    );
  }
}
