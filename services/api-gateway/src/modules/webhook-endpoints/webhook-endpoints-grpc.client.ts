import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  CreateWebhookEndpointRequest,
  DeleteWebhookEndpointResponse,
  ListWebhookDeliveriesResponse,
  ListWebhookEndpointsResponse,
  ListWebhookEventTypesResponse,
  NOTIFICATION_GRPC_CLIENT,
  NOTIFICATION_SERVICE_NAME,
  NotificationServiceClient,
  TestWebhookEndpointResponse,
  UpdateWebhookEndpointRequest,
  WebhookEndpointResponse,
  WebhookEndpointWithSecretResponse,
} from '@synapsedesk/grpc-proto';
import { RequestContext } from '@synapsedesk/common';
import { BaseGrpcClient } from '../../common/grpc/base-grpc.client';

/**
 * The management surface's leg to notification-service.
 *
 * Its own client class beside `NotificationsGrpcClient` rather than more
 * methods on it, mirroring the split on the other end: that one is a person's
 * feed and settings, this one is tenant configuration.
 */
@Injectable()
export class WebhookEndpointsGrpcClient
  extends BaseGrpcClient
  implements OnModuleInit
{
  protected readonly serviceName = 'notification-service';

  private grpc!: NotificationServiceClient;

  constructor(
    @Inject(NOTIFICATION_GRPC_CLIENT) private readonly client: ClientGrpc,
  ) {
    super();
  }

  onModuleInit() {
    this.grpc = this.client.getService<NotificationServiceClient>(
      NOTIFICATION_SERVICE_NAME,
    );
  }

  list(context: RequestContext): Promise<ListWebhookEndpointsResponse> {
    return this.call(
      (metadata) => this.grpc.listWebhookEndpoints({}, metadata),
      context,
    );
  }

  get(
    endpointId: string,
    context: RequestContext,
  ): Promise<WebhookEndpointResponse> {
    return this.call(
      (metadata) => this.grpc.getWebhookEndpoint({ endpointId }, metadata),
      context,
    );
  }

  create(
    request: CreateWebhookEndpointRequest,
    context: RequestContext,
  ): Promise<WebhookEndpointWithSecretResponse> {
    return this.call(
      (metadata) => this.grpc.createWebhookEndpoint(request, metadata),
      context,
    );
  }

  update(
    request: UpdateWebhookEndpointRequest,
    context: RequestContext,
  ): Promise<WebhookEndpointResponse> {
    return this.call(
      (metadata) => this.grpc.updateWebhookEndpoint(request, metadata),
      context,
    );
  }

  delete(
    endpointId: string,
    context: RequestContext,
  ): Promise<DeleteWebhookEndpointResponse> {
    return this.call(
      (metadata) => this.grpc.deleteWebhookEndpoint({ endpointId }, metadata),
      context,
    );
  }

  rotateSecret(
    endpointId: string,
    context: RequestContext,
  ): Promise<WebhookEndpointWithSecretResponse> {
    return this.call(
      (metadata) => this.grpc.rotateWebhookSecret({ endpointId }, metadata),
      context,
    );
  }

  test(
    endpointId: string,
    context: RequestContext,
  ): Promise<TestWebhookEndpointResponse> {
    return this.call(
      (metadata) => this.grpc.testWebhookEndpoint({ endpointId }, metadata),
      context,
    );
  }

  listDeliveries(
    endpointId: string,
    limit: number,
    context: RequestContext,
  ): Promise<ListWebhookDeliveriesResponse> {
    return this.call(
      (metadata) =>
        this.grpc.listWebhookDeliveries({ endpointId, limit }, metadata),
      context,
    );
  }

  listEventTypes(
    context: RequestContext,
  ): Promise<ListWebhookEventTypesResponse> {
    return this.call(
      (metadata) => this.grpc.listWebhookEventTypes({}, metadata),
      context,
    );
  }
}
