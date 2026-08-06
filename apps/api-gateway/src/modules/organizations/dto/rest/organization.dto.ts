import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { trimIfString } from '@synapsedesk/common';

/**
 * Profile only. Quotas (`maxAgentSeats`, storage, token budget) and `status`
 * are deliberately absent: a tenant raising its own seat limit or un-freezing
 * itself is the billing model and the suspension mechanism gone. Both live
 * behind `/platform/*`.
 */
export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Transform(trimIfString)
  readonly name?: string;

  /**
   * Appears in URLs, so changing it breaks every existing link. Treated as a
   * rename with consequences rather than a cosmetic edit — the service rejects
   * a collision with 409 rather than silently suffixing it.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimIfString)
  readonly slug?: string;

  /** Empty string clears it. Globally unique across tenants. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trimIfString)
  readonly domain?: string;
}

/**
 * The two security-relevant tenant settings.
 *
 * `allowedEmailDomains` decides WHO CAN AUTO-JOIN at registration, so it is not
 * a preference — it is an access-control list with a friendlier name.
 */
export class UpdateOrganizationSettingsDto {
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  readonly enforceTwoFactor?: boolean;

  /**
   * REPLACE semantics when present, untouched when absent.
   *
   * The gateway can tell the two apart (`undefined` vs `[]`) but protobuf
   * cannot, which is why the client sets an explicit replace flag on the wire.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  readonly allowedEmailDomains?: string[];
}

export class DeleteOrganizationDto {
  /**
   * Required. Offboarding is finalised by a Super Admin who was not in the
   * room, and "why did Acme leave?" is the first thing they will ask.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  readonly reason!: string;
}

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
export class UsageMeterDto {
  readonly available!: boolean;
  readonly used!: number | null;
  readonly limit!: number | null;
  readonly unavailableReason!: string | null;
}

export class OrganizationUsageResponseDto {
  readonly seats!: UsageMeterDto;
  readonly storage!: UsageMeterDto;
  readonly aiTokens!: UsageMeterDto;
  readonly billingCycleStart!: Date;

  /**
   * The plan, beside the meters — doc 15 §3.1.
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

export class OnboardingStepDto {
  readonly key!: string;
  readonly label!: string;
  readonly complete!: boolean;
}

export class OnboardingResponseDto {
  readonly steps!: OnboardingStepDto[];
  readonly canComplete!: boolean;
  readonly status!: string;
}

export class OffboardResponseDto {
  readonly revokedSessionCount!: number;
}
