import type { NotificationType } from '@synapsedesk/common';
import {
  fromProtoTimestamp,
  fromProtoNotificationType,
  fromProtoWebhookDeliveryStatus,
  requireProtoTimestamp,
  type ListWebhookDeliveriesResponse,
  type TestWebhookEndpointResponse,
  type WebhookDeliveryResponse,
  type WebhookEndpointResponse,
} from '@synapsedesk/grpc-proto';
import type {
  TestWebhookResponseDto,
  WebhookDeliveriesResponseDto,
  WebhookDeliveryResponseDto,
  WebhookEndpointResponseDto,
} from './dto/rest/webhook-endpoint-response.dto';

export function toWebhookEndpointResponseDto(
  endpoint: WebhookEndpointResponse,
): WebhookEndpointResponseDto {
  return {
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description ?? null,
    // **The cast that used to be here is gone**: the wire carries the enum
    // now, so the bridge answers what a cast used to assert. The filter is the
    // honest part — `fromProto` answers null for a value this build cannot
    // name, and a subscription list is re-validated on every write by the
    // owning service, so a null here means the vocabulary was retired under a
    // live subscription rather than that a client sent nonsense. (A delivery's
    // `eventType` stays a `string` for the opposite reason — see the response
    // DTO.)
    eventTypes: endpoint.eventTypes
      .map(fromProtoNotificationType)
      .filter((type): type is NotificationType => type !== null),
    isActive: endpoint.isActive,
    disabledReason: endpoint.disabledReason ?? null,
    createdAt: requireProtoTimestamp(endpoint.createdAt, 'createdAt'),
    updatedAt: requireProtoTimestamp(endpoint.updatedAt, 'updatedAt'),
  };
}

export function toWebhookDeliveryResponseDto(
  delivery: WebhookDeliveryResponse,
): WebhookDeliveryResponseDto {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    // `?? null`, never `?? ''` — the notifications mapper's rule: an empty
    // string is neither a member of the enum nor an absence, so a client
    // switching on it falls through every arm. The bridge's `null` for
    // UNSPECIFIED stays a visible null: a wire value this build does not know
    // is a fact worth seeing, not one worth guessing over.
    status: fromProtoWebhookDeliveryStatus(delivery.status) ?? null,
    attempts: delivery.attempts,
    responseStatus: delivery.responseStatus ?? null,
    lastError: delivery.lastError ?? null,
    occurredAt: requireProtoTimestamp(delivery.occurredAt, 'occurredAt'),
    deliveredAt: fromProtoTimestamp(delivery.deliveredAt) ?? null,
  };
}

export function toWebhookDeliveriesResponseDto(
  response: ListWebhookDeliveriesResponse,
): WebhookDeliveriesResponseDto {
  return { items: response.items.map(toWebhookDeliveryResponseDto) };
}

export function toTestWebhookResponseDto(
  response: TestWebhookEndpointResponse,
): TestWebhookResponseDto {
  return {
    delivered: response.delivered,
    responseStatus: response.responseStatus ?? null,
    error: response.error ?? null,
  };
}
