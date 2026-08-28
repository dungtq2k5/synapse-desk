/** What the platform (Super Admin) routes return. */

import { OrganizationResponseDto } from '../../../organizations/dto/rest/organization-response.dto';
import { UserResponseDto } from '../../../users/dto/rest/user-response.dto';

export class PlatformOrganizationResponseDto {
  readonly organization!: OrganizationResponseDto;
  readonly userCount!: number;
  readonly pendingInvitationCount!: number;
  readonly departmentCount!: number;
  readonly deletedAt!: Date | null;
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
}

export class SubscriptionPlanResponseDto {
  readonly id!: string;
  readonly name!: string;
  /** NULL for a plan ASSIGNED rather than sold — the negotiated agreement. */
  readonly stripeProductId!: string | null;
  readonly maxAgentSeats!: number;
  readonly maxStorageBytes!: number;
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
   * Limits this tenant is ALREADY past under the new plan.
   *
   * Reported, never enforced: a limit gates admission, never tenure. These
   * tenants keep everything they have and are refused their next addition.
   */
  readonly overLimit!: string[];
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
