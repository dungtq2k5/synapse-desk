import {
  fromProtoOrgStatus,
  OrganizationResponse,
  requireProtoTimestamp,
  UsageMeter,
  fromProtoAiModelTier,
  OnboardingResponse,
  OrganizationUsageResponse,
  StorageUsageResponse,
  OrganizationSettingsResponse,
} from '@synapsedesk/grpc-proto';
import {
  OnboardingResponseDto,
  OrganizationResponseDto,
  OrganizationSettingsResponseDto,
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
    status: fromProtoOrgStatus(organization.status),
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
export function toUsageMeterResponseDto(
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
 * @param response auth-service's projection: seats, the plan, the cycle.
 * @param storage ingestion's tenant-scoped usage, or `null` when that leg did
 *   not answer — the storage meter is composed here because auth cannot count
 *   documents.
 * @throws Error if `billingCycleStart` is missing, which the proto requires.
 */
export function toOrganizationUsageResponseDto(
  response: OrganizationUsageResponse,
  storage: StorageUsageResponse | null,
): OrganizationUsageResponseDto {
  return {
    seats: toUsageMeterResponseDto(response.seats),
    // **Ingestion's numbers, not auth's.** auth-service returns this meter
    // `available: false` — it does not count documents and cannot dial the
    // service that does — so the gateway replaces it with the leg it just read.
    // Leaving auth's answer in place would tell a tenant that storage is not
    // enabled for their workspace on the same page as a plan-change refusal
    // quoting their byte count.
    //
    // `limitBytes` is used HERE and must not be used by the plan-change block:
    // this meter is about the tenant's CURRENT ceiling, and that block compares
    // against the target plan's grant.
    storage: storage
      ? {
          available: true,
          used: Number(storage.usedBytes),
          limit: Number(storage.limitBytes),
          unavailableReason: null,
        }
      : {
          available: false,
          used: null,
          limit: null,
          unavailableReason:
            'Storage usage could not be read just now — try again shortly',
        },
    aiTokens: toUsageMeterResponseDto(response.aiTokens),
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
  return { ...response, status: fromProtoOrgStatus(response.status) };
}

/**
 * A settings response, with the wire's absence rendered as `null`.
 *
 * proto3 says "not set" by omitting the field; JSON says it with `null`, and a
 * key that vanishes from a response body is not the same contract as one that
 * is present and empty. A screen rendering the platform ceiling in place of a
 * missing value could not tell an inherited limit from a chosen one.
 *
 * Translated once, here, rather than left for each consumer to guess at.
 */
export function toOrganizationSettingsResponseDto(
  settings: OrganizationSettingsResponse,
): OrganizationSettingsResponseDto {
  return {
    ...settings,
    maxDocumentBytesOverride: settings.maxDocumentBytesOverride ?? null,
    maxAttachmentBytesOverride: settings.maxAttachmentBytesOverride ?? null,
    maxAttachmentsPerMessageOverride:
      settings.maxAttachmentsPerMessageOverride ?? null,
  };
}
