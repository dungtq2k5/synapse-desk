import { Controller } from '@nestjs/common';
import { requireActor, requireTenant } from '@synapsedesk/common';
import { status, type Metadata } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import type { DevicePlatform } from '@synapsedesk/common';
import {
  ListNotificationsRequest,
  ListNotificationsResponse,
  DeviceIdRequest,
  DevicePlatform as ProtoDevicePlatform,
  fromProtoDevicePlatform,
  DeviceTokenResponse,
  ForgetDeviceResponse,
  ListDevicesResponse,
  ListPreferencesResponse,
  RegisterDeviceRequest,
  MarkReadRequest,
  MarkReadResponse,
  NotificationIdRequest,
  NotificationServiceController,
  ResolveTicketByMessageIdRequest,
  ResolveTicketByMessageIdResponse,
  NotificationServiceControllerMethods,
  PreferenceResponse,
  UnreadCountResponse,
  unpackCallerContext,
  UpdatePreferenceRequest,
} from '@synapsedesk/grpc-proto';
import { FeedService } from './feed.service';
import { InboundThreadService } from './inbound-thread.service';
import { PreferencesService } from '../preferences/preferences.service';
import { DeviceTokenService } from '../push/device-token.service';
import { toDeviceTokenResponse } from './feed.mapper';

/**
 * Domain E's gRPC surface
 *
 * **Every method unpacks the caller context, and every one of them is
 * SELF-scoped.** The recipient is `ctx.sub`; no request message carries a user
 * id, which is what makes "read someone else's inbox" unexpressible rather
 * than merely refused.
 *
 * Note what is absent: there is no `Create`. Notifications are written by the
 * NATS consumers in this same process — an RPC would be a spam vector into
 * other users' inboxes and would bypass the `event_id` idempotency that makes
 * at-least-once delivery safe.
 */
@Controller()
@NotificationServiceControllerMethods()
export class NotificationsGrpcController implements NotificationServiceController {
  constructor(
    private readonly feed: FeedService,
    private readonly preferences: PreferencesService,
    private readonly inboundThreads: InboundThreadService,
    private readonly devices: DeviceTokenService,
  ) {}

  /**
   * The `In-Reply-To` fallback.
   *
   * **No caller context, and it does not need one.** The caller is the inbound
   * webhook, which holds a verified Worker signature and no user; the tenant it
   * scopes on travels in the REQUEST, resolved from the address the mail was
   * sent to rather than from anything the message claimed.
   */
  resolveTicketByMessageId(
    request: ResolveTicketByMessageIdRequest,
  ): Promise<ResolveTicketByMessageIdResponse> {
    return this.inboundThreads.resolveTicketByMessageId(request);
  }

  listNotifications(
    request: ListNotificationsRequest,
    metadata?: Metadata,
  ): Promise<ListNotificationsResponse> {
    return this.feed.list(request, unpackCallerContext(metadata));
  }

  async getUnreadCount(
    _request: ListNotificationsRequest,
    metadata?: Metadata,
  ): Promise<UnreadCountResponse> {
    return {
      count: await this.feed.unreadCount(unpackCallerContext(metadata)),
    };
  }

  markRead(
    request: NotificationIdRequest,
    metadata?: Metadata,
  ): Promise<MarkReadResponse> {
    return this.feed.markRead(request, unpackCallerContext(metadata));
  }

  archive(
    request: NotificationIdRequest,
    metadata?: Metadata,
  ): Promise<MarkReadResponse> {
    return this.feed.archive(request, unpackCallerContext(metadata));
  }

  markManyRead(
    request: MarkReadRequest,
    metadata?: Metadata,
  ): Promise<MarkReadResponse> {
    return this.feed.markManyRead(request, unpackCallerContext(metadata));
  }

  listPreferences(
    _request: Record<string, never>,
    metadata?: Metadata,
  ): Promise<ListPreferencesResponse> {
    return this.preferences.list(unpackCallerContext(metadata));
  }

  updatePreference(
    request: UpdatePreferenceRequest,
    metadata?: Metadata,
  ): Promise<PreferenceResponse> {
    return this.preferences.update(request, unpackCallerContext(metadata));
  }

  async registerDevice(
    request: RegisterDeviceRequest,
    metadata?: Metadata,
  ): Promise<DeviceTokenResponse> {
    const context = unpackCallerContext(metadata);

    return toDeviceTokenResponse(
      await this.devices.register({
        userId: requireActor(context),
        organizationId: requireTenant(context),
        token: request.token,
        platform: requirePlatform(request.platform),
        deviceName: request.deviceName,
      }),
    );
  }

  async listDevices(
    _request: Record<string, never>,
    metadata?: Metadata,
  ): Promise<ListDevicesResponse> {
    const context = unpackCallerContext(metadata);
    const devices = await this.devices.listForUser(requireActor(context));

    return { items: devices.map(toDeviceTokenResponse) };
  }

  async forgetDevice(
    request: DeviceIdRequest,
    metadata?: Metadata,
  ): Promise<ForgetDeviceResponse> {
    const context = unpackCallerContext(metadata);
    await this.devices.remove(request.id, requireActor(context));

    return { forgotten: true };
  }
}

/**
 * The wire's platform, refused rather than defaulted when it is not one.
 *
 * **The mapper is the gRPC edge's validation** (development-conventions §7.3),
 * and it is a narrowing of an enum the wire already constrained — not the
 * hand-written string check this replaced. `fromProto` answers `null` for
 * `UNSPECIFIED` and for ts-proto's `UNRECOGNIZED`, and neither is a device: a
 * row silently written as `WEB` is a wrong answer on a settings screen and a
 * wrong branch the day payloads differ per platform.
 */
function requirePlatform(platform: ProtoDevicePlatform): DevicePlatform {
  const narrowed = fromProtoDevicePlatform(platform);

  if (!narrowed) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: 'A device must name a platform',
    });
  }

  return narrowed;
}
