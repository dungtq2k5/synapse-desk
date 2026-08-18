import {
  fromProtoOrgStatus,
  OrganizationResponse,
  requireProtoTimestamp,
  UsageMeter,
  fromProtoAiModelTier,
  OnboardingResponse,
  OrganizationUsageResponse,
} from '@synapsedesk/grpc-proto';
import {
  OnboardingResponseDto,
  OrganizationResponseDto,
  OrganizationUsageResponseDto,
  UsageMeterResponseDto,
} from './dto/rest/organization-response.dto';

/**
 * Wire -> REST for an organization.
 *
 * Extracted from the tenant-facing client because the PLATFORM client needs the
 * identical conversion — a second copy would drift the first time a field was
 * added, and the two surfaces would disagree about the same row.
 */
export function toOrganizationResponseDto(
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
    billingCycleStart: requireProtoTimestamp(
      organization.billingCycleStart,
      'billingCycleStart',
    ),
    createdAt: requireProtoTimestamp(organization.createdAt, 'createdAt'),
    updatedAt: requireProtoTimestamp(organization.updatedAt, 'updatedAt'),
  };
}

/**
 * Unset numbers become `null`, never 0.
 *
 * A meter reporting `used: 0` claims the tenant has consumed nothing; a meter
 * whose domain does not exist yet cannot make that claim, and the difference
 * matters to anyone reading a usage page before deciding to upgrade.
 */
export function toUsageMeterDto(
  meter: UsageMeter | undefined,
): UsageMeterResponseDto {
  if (!meter) {
    throw new Error('Received a usage response without a meter');
  }

  return {
    available: meter.available,
    used: meter.available ? (meter.used ?? null) : null,
    limit: meter.available ? (meter.limit ?? null) : null,
    unavailableReason: meter.unavailableReason ?? null,
  };
}

/**
 * Converts an `OrganizationUsageResponse` off the wire into its REST DTO.
 *
 * `aiModelTier` becomes the domain string; the proto enum's number is
 * meaningless to a client rendering a plan.
 *
 * @throws Error if `billingCycleStart` is missing, which the proto requires.
 */
export function toOrganizationUsageResponseDto(
  response: OrganizationUsageResponse,
): OrganizationUsageResponseDto {
  return {
    seats: toUsageMeterDto(response.seats),
    storage: toUsageMeterDto(response.storage),
    aiTokens: toUsageMeterDto(response.aiTokens),
    aiModelTier: fromProtoAiModelTier(response.aiModelTier),
    planName: response.planName,
    currentPeriodEnd: response.currentPeriodEnd
      ? requireProtoTimestamp(response.currentPeriodEnd, 'currentPeriodEnd')
      : null,
    billingCycleStart: requireProtoTimestamp(
      response.billingCycleStart,
      'billingCycleStart',
    ),
  };
}

/** Converts an `OnboardingResponse` off the wire into its REST DTO. */
export function toOnboardingResponseDto(
  response: OnboardingResponse,
): OnboardingResponseDto {
  return { ...response, status: fromProtoOrgStatus(response.status) ?? '' };
}
