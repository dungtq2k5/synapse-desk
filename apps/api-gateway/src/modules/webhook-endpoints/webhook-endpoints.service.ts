import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { toProtoNotificationType } from '@synapsedesk/grpc-proto';
import {
  toNotificationTypes,
  toTestWebhookResponseDto,
  toWebhookDeliveriesResponseDto,
  toWebhookEndpointResponseDto,
} from './webhook-endpoint.mapper';
import { WebhookEndpointsGrpcClient } from './webhook-endpoints-grpc.client';
import type {
  CreateWebhookEndpointDto,
  UpdateWebhookEndpointDto,
} from './dto/rest/webhook-endpoint.dto';
import type {
  DeleteWebhookEndpointResponseDto,
  TestWebhookResponseDto,
  WebhookDeliveriesResponseDto,
  WebhookEndpointResponseDto,
  WebhookEndpointsResponseDto,
  WebhookEndpointWithSecretResponseDto,
  WebhookEventTypesResponseDto,
} from './dto/rest/webhook-endpoint-response.dto';

@Injectable()
export class WebhookEndpointsService {
  constructor(private readonly client: WebhookEndpointsGrpcClient) {}

  async list(context: RequestContext): Promise<WebhookEndpointsResponseDto> {
    const response = await this.client.list(context);

    return { items: response.items.map(toWebhookEndpointResponseDto) };
  }

  async get(
    id: string,
    context: RequestContext,
  ): Promise<WebhookEndpointResponseDto> {
    return toWebhookEndpointResponseDto(await this.client.get(id, context));
  }

  async create(
    dto: CreateWebhookEndpointDto,
    context: RequestContext,
  ): Promise<WebhookEndpointWithSecretResponseDto> {
    const response = await this.client.create(
      {
        url: dto.url,
        description: dto.description,
        eventTypes: dto.eventTypes.map(toProtoNotificationType),
      },
      context,
    );

    return {
      endpoint: toWebhookEndpointResponseDto(
        requireEndpoint(response.endpoint),
      ),
      secret: response.secret,
    };
  }

  async update(
    id: string,
    dto: UpdateWebhookEndpointDto,
    context: RequestContext,
  ): Promise<WebhookEndpointResponseDto> {
    return toWebhookEndpointResponseDto(
      await this.client.update(
        {
          endpointId: id,
          url: dto.url,
          description: dto.description,
          // The wrapper is how "leave them" and "replace them" stay different
          // on a proto3 wire that cannot tell an empty repeated from an absent
          // one.
          eventTypes:
            dto.eventTypes === undefined
              ? undefined
              : { values: dto.eventTypes.map(toProtoNotificationType) },
          isActive: dto.isActive,
        },
        context,
      ),
    );
  }

  async delete(
    id: string,
    context: RequestContext,
  ): Promise<DeleteWebhookEndpointResponseDto> {
    const response = await this.client.delete(id, context);

    return { deleted: response.deleted };
  }

  async rotateSecret(
    id: string,
    context: RequestContext,
  ): Promise<WebhookEndpointWithSecretResponseDto> {
    const response = await this.client.rotateSecret(id, context);

    return {
      endpoint: toWebhookEndpointResponseDto(
        requireEndpoint(response.endpoint),
      ),
      secret: response.secret,
    };
  }

  async test(
    id: string,
    context: RequestContext,
  ): Promise<TestWebhookResponseDto> {
    return toTestWebhookResponseDto(await this.client.test(id, context));
  }

  async listDeliveries(
    id: string,
    limit: number,
    context: RequestContext,
  ): Promise<WebhookDeliveriesResponseDto> {
    return toWebhookDeliveriesResponseDto(
      await this.client.listDeliveries(id, limit, context),
    );
  }

  async listEventTypes(
    context: RequestContext,
  ): Promise<WebhookEventTypesResponseDto> {
    const response = await this.client.listEventTypes(context);

    // The catalogue is the owning service's `NOTIFICATION_TYPE_VALUES`, and
    // the enum is what carries that now — so this narrows through the bridge
    // rather than restating the guarantee as a cast.
    return { types: toNotificationTypes(response.types) };
  }
}

/** The proto marks the nested message optional; a create without one is a bug. */
function requireEndpoint<T>(endpoint: T | undefined): T {
  if (!endpoint) {
    throw new Error('notification-service answered without the endpoint');
  }

  return endpoint;
}
