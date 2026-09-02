import {
  toProtoNotificationType,
  toProtoTimestamp,
  toProtoWebhookDeliveryStatus,
  type WebhookDeliveryResponse,
  type WebhookEndpointResponse,
} from '@synapsedesk/grpc-proto';
import type {
  WebhookDelivery,
  WebhookEndpoint,
} from '../../generated/prisma/client';

/**
 * The endpoint, WITHOUT its secrets — structurally.
 *
 * The wire message has no secret field at all, so a listing cannot leak the
 * signing key by mapper mistake; the secret rides only the create/rotate
 * response, built at those two call sites.
 */
export function toWebhookEndpointResponse(
  row: WebhookEndpoint,
): WebhookEndpointResponse {
  return {
    id: row.id,
    url: row.url,
    // `?? undefined`, never `?? ''` — plan.mapper.ts's rule: an absent
    // description must not render as an empty one somebody typed.
    description: row.description ?? undefined,
    // A `String[]` column crossing to the enum. `toProto` answers UNSPECIFIED
    // for anything unrecognized rather than throwing: one row holding a retired
    // member must not fail the whole listing.
    eventTypes: row.eventTypes.map(toProtoNotificationType),
    isActive: row.isActive,
    disabledReason: row.disabledReason ?? undefined,
    createdAt: toProtoTimestamp(row.createdAt),
    updatedAt: toProtoTimestamp(row.updatedAt),
  };
}

export function toWebhookDeliveryResponse(
  row: WebhookDelivery,
): WebhookDeliveryResponse {
  return {
    id: row.id,
    eventId: row.eventId,
    eventType: row.eventType,
    // The `to*` bridge direction is deliberately wide: the caller is handing
    // over a VarChar column, and a row carrying a status this build does not
    // know maps to UNSPECIFIED rather than throwing the whole listing away.
    status: toProtoWebhookDeliveryStatus(row.status),
    attempts: row.attempts,
    responseStatus: row.responseStatus ?? undefined,
    lastError: row.lastError ?? undefined,
    occurredAt: toProtoTimestamp(row.occurredAt),
    deliveredAt: row.deliveredAt
      ? toProtoTimestamp(row.deliveredAt)
      : undefined,
  };
}
