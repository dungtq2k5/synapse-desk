import {
  fromProtoOrgStatus,
  OrganizationResponse,
  requireTimestamp,
} from '@synapsedesk/grpc-proto';
import { OrganizationResponseDto } from './dto/rest/organization.dto';

/**
 * Wire -> REST for an organization.
 *
 * Extracted from the tenant-facing client because the PLATFORM client needs the
 * identical conversion — a second copy would drift the first time a field was
 * added, and the two surfaces would disagree about the same row.
 */
export function toOrganizationDto(
  organization: OrganizationResponse,
): OrganizationResponseDto {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    domain: organization.domain ?? null,
    status: fromProtoOrgStatus(organization.status) ?? '',
    enforceTwoFactor: organization.enforceTwoFactor,
    allowedEmailDomains: organization.allowedEmailDomains,
    maxAgentSeats: organization.maxAgentSeats,
    maxStorageBytes: organization.maxStorageBytes,
    monthlyAiTokenBudget: organization.monthlyAiTokenBudget,
    billingCycleStart: requireTimestamp(
      organization.billingCycleStart,
      'billingCycleStart',
    ),
    createdAt: requireTimestamp(organization.createdAt, 'createdAt'),
    updatedAt: requireTimestamp(organization.updatedAt, 'updatedAt'),
  };
}
