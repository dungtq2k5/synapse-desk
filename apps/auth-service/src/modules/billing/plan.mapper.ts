import type {
  SubscriptionPlan,
  SubscriptionPlanPrice,
} from '../../generated/prisma/client';
import {
  toProtoAiModelTier,
  toProtoTimestamp,
  type SubscriptionPlanResponse,
} from '@synapsedesk/grpc-proto';

/**
 * What every plan read needs alongside the row.
 *
 * The subscriber count is not decoration: it decides whether a delete is
 * allowed and how large an apply's blast radius is, and computing it separately
 * would be one query per plan on a list endpoint.
 */
export const PLAN_INCLUDE = {
  prices: true,
  _count: { select: { organizations: true } },
} as const;

/** A plan row as `PLAN_INCLUDE` returns it. */
export type PlanRow = SubscriptionPlan & {
  prices: SubscriptionPlanPrice[];
  _count: { organizations: number };
};

export function toSubscriptionPlanResponse(
  plan: PlanRow,
): SubscriptionPlanResponse {
  return {
    id: plan.id,
    name: plan.name,
    // `?? undefined`, never `?? ''`. NULL means a plan ASSIGNED rather than
    // sold — the negotiated agreement — and an empty string would read as a
    // product id somebody forgot to fill in.
    stripeProductId: plan.stripeProductId ?? undefined,
    maxAgentSeats: plan.maxAgentSeats,
    maxStorageBytes: Number(plan.maxStorageBytes),
    monthlyAiTokenBudget: Number(plan.monthlyAiTokenBudget),
    aiModelTier: toProtoAiModelTier(plan.aiModelTier),
    maxDocumentBytes: Number(plan.maxDocumentBytes),
    maxAttachmentBytes: Number(plan.maxAttachmentBytes),
    isActive: plan.isActive,
    prices: plan.prices.map((price) => ({
      id: price.id,
      stripePriceId: price.stripePriceId,
      interval: price.interval,
    })),
    subscriberCount: plan._count.organizations,
    createdAt: toProtoTimestamp(plan.createdAt),
    updatedAt: toProtoTimestamp(plan.updatedAt),
    deletedAt: plan.deletedAt ? toProtoTimestamp(plan.deletedAt) : undefined,
  };
}
