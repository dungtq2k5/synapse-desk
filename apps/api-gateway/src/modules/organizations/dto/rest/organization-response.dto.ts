/** @file What the organization routes return. */

export class OrganizationResponseDto {
  readonly id!: string;
  readonly name!: string;
  readonly slug!: string;
  readonly domain!: string | null;
  readonly status!: string;
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
  readonly aiModelTier!: string | null;
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
  readonly status!: string;
}

export class OffboardResponseDto {
  readonly revokedSessionCount!: number;
}
