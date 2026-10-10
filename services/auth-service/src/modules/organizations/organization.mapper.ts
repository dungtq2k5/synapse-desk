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
    // The plan grants, NOT overrides: both columns are NOT NULL, so there is
    // no absent case to translate and no `?? undefined` below applies to them.
    maxDocumentBytes: Number(organization.maxDocumentBytes),
    maxAttachmentBytes: Number(organization.maxAttachmentBytes),
    maxDocumentUploads: organization.maxDocumentUploads,
    maxAnalyticsRangeDays: organization.maxAnalyticsRangeDays,
    billingCycleStart: toProtoTimestamp(organization.billingCycleStart),
    // `?? undefined`, never `?? 0`. NULL means the tenant configured nothing
    // and the layer above applies; zero would be a limit that refuses
    // everything, and the two must not collapse on the way out.
    maxDocumentBytesOverride:
      organization.maxDocumentBytesOverride === null
        ? undefined
        : Number(organization.maxDocumentBytesOverride),
    maxAttachmentBytesOverride:
      organization.maxAttachmentBytesOverride === null
        ? undefined
        : Number(organization.maxAttachmentBytesOverride),
    maxAttachmentsPerMessageOverride:
      organization.maxAttachmentsPerMessageOverride ?? undefined,
    createdAt: toProtoTimestamp(organization.createdAt),
    updatedAt: toProtoTimestamp(organization.updatedAt),
  };
}
