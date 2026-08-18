import {
  fromProtoAiModelTier,
  fromProtoOrgStatus,
  ListInvoicesResponse,
  requireProtoTimestamp,
  SubscriptionResponse,
} from '@synapsedesk/grpc-proto';
import {
  InvoiceResponseDto,
  SubscriptionResponseDto,
} from './dto/rest/billing-response.dto';

/**
 * Converts a `SubscriptionResponse` off the wire into its REST DTO.
 *
 * @throws Error if `billingCycleStart` is missing, which the proto requires.
 */
export function toSubscriptionResponseDto(
  response: SubscriptionResponse,
): SubscriptionResponseDto {
  return {
    stripeCustomerId: response.stripeCustomerId ?? null,
    stripeSubscriptionId: response.stripeSubscriptionId ?? null,
    planName: response.planName,
    maxAgentSeats: response.maxAgentSeats,
    maxStorageBytes: response.maxStorageBytes,
    monthlyAiTokenBudget: response.monthlyAiTokenBudget,
    aiModelTier: fromProtoAiModelTier(response.aiModelTier) ?? '',
    billingCycleStart: requireProtoTimestamp(
      response.billingCycleStart,
      'billingCycleStart',
    ),
    status: fromProtoOrgStatus(response.status) ?? '',
  };
}

/**
 * Converts a `ListInvoicesResponse` off the wire into its REST DTOs.
 *
 * @throws Error if an invoice has no `created`, which the proto requires.
 */
export function toInvoiceResponseDtos(
  response: ListInvoicesResponse,
): InvoiceResponseDto[] {
  return response.items.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    amountDue: invoice.amountDue,
    currency: invoice.currency,
    status: invoice.status,
    created: requireProtoTimestamp(invoice.created, 'created'),
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
  }));
}
