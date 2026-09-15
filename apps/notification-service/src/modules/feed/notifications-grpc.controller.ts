import { Controller } from '@nestjs/common';
import {
  JobHealthService,
  requireActor,
  requireTenant,
} from '@synapsedesk/common';
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
  toProtoTimestamp,
  CreateWebhookEndpointRequest,
  DeleteWebhookEndpointResponse,
  ListWebhookDeliveriesRequest,
  ListWebhookDeliveriesResponse,
  ListWebhookEndpointsRequest,
  ListWebhookEndpointsResponse,
  ListWebhookEventTypesResponse,
  NotificationJobHealthResponse,
  TestWebhookEndpointResponse,
  UpdateWebhookEndpointRequest,
  WebhookEndpointIdRequest,
  WebhookEndpointResponse,
  WebhookEndpointWithSecretResponse,
  UpdatePreferenceRequest,
} from '@synapsedesk/grpc-proto';
import { FeedService } from './feed.service';
import { InboundThreadService } from './inbound-thread.service';
import { PreferencesService } from '../preferences/preferences.service';
import { DeviceTokenService } from '../push/device-token.service';
import { toDeviceTokenResponse } from './feed.mapper';
import { WebhookAdminService } from '../webhooks/webhook-admin.service';

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
    private readonly webhooks: WebhookAdminService,
    private readonly jobHealth: JobHealthService,
  ) {}

  /**
   * The `In-Reply-To` fallback.
   *
   * **No caller context, and it does not need one.** The caller is the inbound
   * webhook, which holds a verified Resend signature and no user; the tenant it
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

  // -------------------------------------------------------------- Webhooks
  //
  // Tenant configuration, not a user setting — the gateway gates these behind
  // `organization.read` / `organization.update`, and every method here scopes
  // by the caller's tenant so another workspace's endpoint id selects nothing.

  listWebhookEndpoints(
    _request: ListWebhookEndpointsRequest,
    metadata?: Metadata,
  ): Promise<ListWebhookEndpointsResponse> {
    return this.webhooks.list(unpackCallerContext(metadata));
  }

  getWebhookEndpoint(
    request: WebhookEndpointIdRequest,
    metadata?: Metadata,
  ): Promise<WebhookEndpointResponse> {
    return this.webhooks.get(request.endpointId, unpackCallerContext(metadata));
  }

  createWebhookEndpoint(
    request: CreateWebhookEndpointRequest,
    metadata?: Metadata,
  ): Promise<WebhookEndpointWithSecretResponse> {
    return this.webhooks.create(request, unpackCallerContext(metadata));
  }

  updateWebhookEndpoint(
    request: UpdateWebhookEndpointRequest,
    metadata?: Metadata,
  ): Promise<WebhookEndpointResponse> {
    return this.webhooks.update(request, unpackCallerContext(metadata));
  }

  deleteWebhookEndpoint(
    request: WebhookEndpointIdRequest,
    metadata?: Metadata,
  ): Promise<DeleteWebhookEndpointResponse> {
    return this.webhooks.delete(
      request.endpointId,
      unpackCallerContext(metadata),
    );
  }

  rotateWebhookSecret(
    request: WebhookEndpointIdRequest,
    metadata?: Metadata,
  ): Promise<WebhookEndpointWithSecretResponse> {
    return this.webhooks.rotateSecret(
      request.endpointId,
      unpackCallerContext(metadata),
    );
  }

  testWebhookEndpoint(
    request: WebhookEndpointIdRequest,
    metadata?: Metadata,
  ): Promise<TestWebhookEndpointResponse> {
    return this.webhooks.test(
      request.endpointId,
      unpackCallerContext(metadata),
    );
  }

  listWebhookDeliveries(
    request: ListWebhookDeliveriesRequest,
    metadata?: Metadata,
  ): Promise<ListWebhookDeliveriesResponse> {
    return this.webhooks.listDeliveries(request, unpackCallerContext(metadata));
  }

  listWebhookEventTypes(): ListWebhookEventTypesResponse {
    return this.webhooks.listEventTypes();
  }

  /** The heartbeat — every row, unjudged, for the gateway's fourth leg. */
  async getNotificationJobHealth(): Promise<NotificationJobHealthResponse> {
    const rows = await this.jobHealth.list();

    return {
      items: rows.map((row) => ({
        jobName: row.jobName,
        lastStartedAt: row.lastStartedAt
          ? toProtoTimestamp(row.lastStartedAt)
          : undefined,
        lastSucceededAt: row.lastSucceededAt
          ? toProtoTimestamp(row.lastSucceededAt)
          : undefined,
        lastDurationMs: row.lastDurationMs ?? undefined,
        lastError: row.lastError ?? undefined,
        consecutiveFailures: row.consecutiveFailures,
      })),
    };
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
