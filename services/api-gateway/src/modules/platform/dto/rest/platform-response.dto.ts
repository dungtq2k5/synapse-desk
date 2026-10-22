/** What the platform (Super Admin) routes return. */

import {
  OrganizationResponseDto,
  UsageMeterResponseDto,
} from '../../../organizations/dto/rest/organization-response.dto';
import { UserResponseDto } from '../../../users/dto/rest/user-response.dto';
import { ApiProperty } from '@nestjs/swagger';
import {
  OVER_LIMIT_DIMENSIONS,
  type OverLimitDimension,
} from '@synapsedesk/contracts';

export class PlatformOrganizationResponseDto {
  readonly organization!: OrganizationResponseDto;
  readonly userCount!: number;
  readonly pendingInvitationCount!: number;
  readonly departmentCount!: number;
  readonly deletedAt!: Date | null;
  /** The catalogue plan it's on, or null when none is assigned. */
  readonly planName!: string | null;
  /**
   * Whether a Stripe subscription grants the plan: a limit edited by hand
   * then lasts until Stripe's next event. False for a plan assigned by hand.
   */
  readonly billedThroughStripe!: boolean;
  /**
   * When the status last changed ("Frozen since"). Null for an organization
   * whose status changed before that was recorded.
   */
  readonly statusChangedAt!: Date | null;
}

export class PlatformOrganizationStatusResponseDto extends PlatformOrganizationResponseDto {
  /** Sessions the change ended: every one on a freeze, none otherwise. */
  readonly revokedSessionCount!: number;
}

/** One limit a plan breaks: what's in use against what it allows. */
export class OverLimitItemResponseDto {
  @ApiProperty({ enum: OVER_LIMIT_DIMENSIONS })
  readonly dimension!: OverLimitDimension;
  /** Seats, bytes or documents, by dimension. */
  readonly inUse!: number;
  readonly allowed!: number;
}

/** An organization's meters, as its own usage page reads them. */
export class PlatformOrganizationUsageResponseDto {
  /** Members plus pending invitations: the count the seat limit refuses on. */
  readonly seats!: UsageMeterResponseDto;
  readonly storage!: UsageMeterResponseDto;
  /** This cycle's AI spend against the monthly allowance, in micros. */
  readonly aiTokens!: UsageMeterResponseDto;
}

export class PlatformOrganizationDetailResponseDto extends PlatformOrganizationResponseDto {
  /** Each meter is `READ_FAILED` when its service didn't answer; the page still loads. */
  readonly usage!: PlatformOrganizationUsageResponseDto;
}

export class PlatformUserResponseDto {
  readonly user!: UserResponseDto;
  /** Always present on a tenant user; null only for a platform Super Admin. */
  readonly organizationId!: string | null;
  readonly organizationName!: string | null;
  readonly roleNames!: string[];
  readonly deletedAt!: Date | null;
}

export class CreatePlatformOrganizationResponseDto {
  readonly organization!: PlatformOrganizationResponseDto;
  readonly admin!: UserResponseDto;
}

export class OffboardResponseDto {
  readonly revokedSessionCount!: number;
}

export class PlatformMetricsResponseDto {
  readonly totalOrganizations!: number;
  readonly organizationsByStatus!: Record<string, number>;
  readonly totalUsers!: number;
  readonly activeUsers!: number;
  readonly pendingInvitations!: number;
  readonly liveSessions!: number;
  readonly seatsAllocated!: number;
  readonly seatsInUse!: number;
  readonly generatedAt!: Date;
}

export class SubscriptionPlanPriceResponseDto {
  readonly id!: string;
  /** Stripe's id. `month` and `year` on one plan are the reason this is a list. */
  readonly stripePriceId!: string;
  /**
   * The billing period this price charges for — `month` or `year` in practice.
   *
   * Not narrowed to those two: the value is whatever Stripe sent, and Stripe's
   * own vocabulary includes `day` and `week`.
   */
  // Typed `string` ON PURPOSE, unlike the REQUEST DTO, which validates against
  // `PLAN_BILLING_INTERVALS` and earns the union. This is a RESPONSE reading a
  // `VarChar` column, so a union here would claim a guarantee nothing enforces
  // and type the first row carrying a third interval as impossible while it sat
  // in the database. Same asymmetry the enum bridges keep: the `to*` direction
  // is deliberately wide because the caller is handing over a column.
  readonly interval!: string;
  /**
   * What Stripe charges, in the currency's smallest unit (cents for `usd`).
   * Read from Stripe when the plan is created; null for a price stored before
   * amounts were.
   */
  readonly unitAmount!: number | null;
  /** Stripe's lowercase currency code, e.g. `usd`. */
  readonly currency!: string | null;
}

export class SubscriptionPlanResponseDto {
  readonly id!: string;
  readonly name!: string;
  /** NULL for a plan ASSIGNED rather than sold — the negotiated agreement. */
  readonly stripeProductId!: string | null;
  readonly maxAgentSeats!: number;
  readonly maxStorageBytes!: number;
  /**
   * The AI allowance a month, in millionths of a US dollar (1000000 is
   * $1.00), charged by what each AI request costs. Not tokens, whatever the
   * name says.
   */
  readonly monthlyAiTokenBudget!: number;
  readonly aiModelTier!: string;
  readonly maxDocumentBytes!: number;
  readonly maxAttachmentBytes!: number;
  readonly maxDocumentUploads!: number;
  /** Days of history analytics may look back over. Narrowing it is retroactive. */
  readonly maxAnalyticsRangeDays!: number;
  readonly isActive!: boolean;
  readonly prices!: SubscriptionPlanPriceResponseDto[];
  /** Live tenants on this plan: the delete gate and the apply's blast radius. */
  readonly subscriberCount!: number;
  readonly createdAt!: Date;
  readonly updatedAt!: Date;
  readonly deletedAt!: Date | null;
}

export class PlanSubscriberProjectionResponseDto {
  readonly organizationId!: string;
  readonly organizationName!: string;
  /** Field name → `"before -> after"`, for the columns this apply would change. */
  readonly changes!: Record<string, string>;
  /**
   * The AFTER value of every NUMERIC column in `changes`, keyed the same way.
   *
   * `changes` renders for a human; this is what a machine reads. A key absent
   * here means the column is not changing — never "zero", which would put every
   * tenant over. `aiModelTier` is a string and never appears.
   *
   * known-gaps #21: the composer used to parse the display string, and a
   * cosmetic change to its separator silently disarmed two limit checks.
   */
  readonly after!: Record<string, number>;
  /**
   * Limits this tenant is ALREADY past under the new plan.
   *
   * Reported, never enforced: a limit gates admission, never tenure. These
   * tenants keep everything they have and are refused their next addition.
   */
  readonly overLimit!: string[];
  /**
   * The same limits as data, one per limit it breaks: what's in use against
   * what the new plan allows. The strings above stay one release.
   */
  readonly overLimitItems!: OverLimitItemResponseDto[];
  /** Off-catalogue by deliberate policy; this apply does not touch them. */
  readonly skippedPinned!: boolean;
  /** Held to the next cycle roll: lowering a part-spent budget is retroactive. */
  readonly budgetDeferred!: boolean;
}

export class ApplyPlanResponseDto {
  readonly subscribers!: PlanSubscriberProjectionResponseDto[];
  readonly dryRun!: boolean;
  readonly changedCount!: number;
  readonly skippedPinnedCount!: number;
  readonly overLimitCount!: number;
  /**
   * Which limits this run actually checked.
   *
   * A dimension absent from the list was NOT evaluated, and `overLimitCount`
   * says nothing about it — render it as unknown rather than as zero affected.
   */
  readonly evaluatedDimensions!: string[];
}

export class DeletePlanResponseDto {
  readonly deleted!: boolean;
}
