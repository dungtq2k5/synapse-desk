/** @file What the organization routes return. */

import type { AiModelTier, OrgStatus } from '@synapsedesk/common';

export class OrganizationResponseDto {
  readonly id!: string;
  readonly name!: string;
  readonly slug!: string;
  readonly domain!: string | null;
  /** `OrgStatus`, null when the bridge answers null for `UNSPECIFIED` */
  readonly status!: OrgStatus | null;
  readonly enforceTwoFactor!: boolean;
  readonly allowedEmailDomains!: string[];
  readonly maxAgentSeats!: number;
  readonly maxStorageBytes!: number;
  readonly monthlyAiTokenBudget!: number;
  readonly billingCycleStart!: Date;
  readonly createdAt!: Date;
  readonly updatedAt!: Date;
}

export class OrganizationSettingsResponseDto {
  readonly enforceTwoFactor!: boolean;
  readonly allowedEmailDomains!: string[];
  /** Accepted free-mail domains worth a second look. Never an error. */
  readonly publicDomainWarnings!: string[];

  /**
   * What this workspace has configured, or `null` where it has configured
   * nothing.
   *
   * `null` rather than the platform number: a screen that renders the ceiling
   * as if the tenant had chosen it cannot show the difference between an
   * inherited limit and a deliberate one, and the tenant would have no way to
   * tell whether clearing the field changes anything.
   */
  readonly maxDocumentBytesOverride!: number | null;
  readonly maxAttachmentBytesOverride!: number | null;
  readonly maxAttachmentsPerMessageOverride!: number | null;
}

/**
 * `used`/`limit` are null when `available` is false — deliberately not 0, which
 * would read as "no usage" rather than "we cannot tell you yet".
 */
export class UsageMeterResponseDto {
  readonly available!: boolean;
  readonly used!: number | null;
  readonly limit!: number | null;
  readonly unavailableReason!: string | null;
}

export class OrganizationUsageResponseDto {
  readonly seats!: UsageMeterResponseDto;
  /**
   * Composed at the GATEWAY from ingestion's tenant-scoped usage read.
   *
   * auth-service cannot answer it — it does not count documents and cannot dial
   * the service that does — so it sends this meter unavailable and the gateway
   * replaces it. `available: false` here therefore means the ingestion leg did
   * not answer, and never "this workspace has no storage".
   *
   * The number is the one a plan-change refusal quotes. It has to be: a tenant
   * told to reduce storage opens this page to find out what to delete.
   */
  readonly storage!: UsageMeterResponseDto;
  readonly aiTokens!: UsageMeterResponseDto;
  readonly billingCycleStart!: Date;

  /**
   * The plan, beside the meters
   *
   * This is the page a customer opens when they hit a limit, and a limit with
   * no plan next to it is a number they cannot act on: the next question is
   * always "what would I get if I upgraded".
   */
  readonly aiModelTier!: AiModelTier | null;
  readonly planName!: string;
  /** NULL for a grandfathered tenant, who has no invoice period at all. */
  readonly currentPeriodEnd!: Date | null;
}

export class OnboardingStepResponseDto {
  readonly key!: string;
  readonly label!: string;
  readonly complete!: boolean;
}

export class OnboardingResponseDto {
  readonly steps!: OnboardingStepResponseDto[];
  readonly canComplete!: boolean;
  /** `OrgStatus` — see {@link OrganizationResponseDto.status}. */
  readonly status!: OrgStatus | null;
}

export class OffboardResponseDto {
  readonly revokedSessionCount!: number;
}
