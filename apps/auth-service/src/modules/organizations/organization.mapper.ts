import {
  OrganizationResponse,
  toProtoAiModelTier,
  toProtoOrgStatus,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';
import { Organization } from '../../generated/prisma/client';

/**
 * An ALLOW-LIST, like every other mapper here.
 *
 * `BigInt` columns are converted explicitly: Prisma returns `bigint`, the wire
 * carries int64 as a JS number under `longs: Number`, and passing a bigint
 * through unconverted throws at serialization rather than at the type level.
 */
export function toOrganizationResponse(
  organization: Organization,
): OrganizationResponse {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    domain: organization.domain ?? undefined,
    status: toProtoOrgStatus(organization.status),
    enforceTwoFactor: organization.enforceTwoFactor,
    allowedEmailDomains: organization.allowedEmailDomains,
    maxAgentSeats: organization.maxAgentSeats,
    maxStorageBytes: Number(organization.maxStorageBytes),
    monthlyAiTokenBudget: Number(organization.monthlyAiTokenBudget),
    aiModelTier: toProtoAiModelTier(organization.aiModelTier),
    billingCycleStart: toProtoTimestamp(organization.billingCycleStart),
    createdAt: toProtoTimestamp(organization.createdAt),
    updatedAt: toProtoTimestamp(organization.updatedAt),
  };
}
