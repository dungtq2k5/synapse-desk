import {
  fromProtoAiModelTier,
  fromProtoOrgStatus,
  fromProtoTimestamp,
  ListInvoicesResponse,
  ListTenantPlansResponse,
  PlanChangeResponse,
  requireProtoTimestamp,
  SubscriptionResponse,
} from '@synapsedesk/grpc-proto';
import {
  InvoiceResponseDto,
  PlanChangeResponseDto,
  SubscriptionResponseDto,
  TenantPlanResponseDto,
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
    aiModelTier: fromProtoAiModelTier(response.aiModelTier),
    billingCycleStart: requireProtoTimestamp(
      response.billingCycleStart,
      'billingCycleStart',
    ),
    status: fromProtoOrgStatus(response.status),
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

/**
 * The tenant catalogue, off the wire.
 *
 * `bigint`-shaped grants arrive as `number` from the proto loader; they are
 * re-wrapped here rather than in the controller so the DTO is the only shape a
 * client ever sees.
 */
export function toTenantPlanResponseDtos(
  response: ListTenantPlansResponse,
): TenantPlanResponseDto[] {
  return response.items.map((plan) => ({
    id: plan.id,
    name: plan.name,
    maxAgentSeats: plan.maxAgentSeats,
    maxStorageBytes: Number(plan.maxStorageBytes),
    monthlyAiTokenBudget: Number(plan.monthlyAiTokenBudget),
    aiModelTier: fromProtoAiModelTier(plan.aiModelTier),
    maxDocumentBytes: Number(plan.maxDocumentBytes),
    maxAttachmentBytes: Number(plan.maxAttachmentBytes),
    maxDocumentUploads: plan.maxDocumentUploads,
    maxAnalyticsRangeDays: plan.maxAnalyticsRangeDays,
    prices: plan.prices.map((price) => ({
      stripePriceId: price.stripePriceId,
      interval: price.interval,
    })),
  }));
}

/** What Stripe accepted. The entitlement write lands on the webhook. */
export function toPlanChangeResponseDto(
  response: PlanChangeResponse,
): PlanChangeResponseDto {
  return {
    planId: response.planId,
    planName: response.planName,
    effectiveAt: fromProtoTimestamp(response.effectiveAt) ?? null,
    creditIssued: response.creditIssued ?? null,
  };
}
