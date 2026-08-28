import { NoEmoji } from '../../../../common/decorators/no-emoji.decorator';
import { MARKDOWN_FIELD_CONTRACT } from '../../../../common/config/markdown-contract.config';
import {
  MAX_ADMIN_REASON_LENGTH,
  MAX_ALLOWED_EMAIL_DOMAINS,
  MAX_FULL_NAME_LENGTH,
  MAX_ORGANIZATION_DOMAIN_LENGTH,
  MAX_ORGANIZATION_NAME_LENGTH,
  MAX_ORGANIZATION_SLUG_LENGTH,
  ORGANIZATION_SLUG_PATTERN,
  MAX_ROLE_DESCRIPTION_LENGTH,
  MAX_ROLE_NAME_LENGTH,
  MIN_AGENT_SEATS,
  MIN_AI_TOKEN_BUDGET,
  MIN_FULL_NAME_LENGTH,
  MIN_ORGANIZATION_NAME_LENGTH,
  MIN_ORGANIZATION_SLUG_LENGTH,
  MIN_STORAGE_BYTES,
  MAX_PLAN_NAME_LENGTH,
  MAX_PLAN_PRICES,
  MAX_STRIPE_ID_LENGTH,
  MIN_PLAN_NAME_LENGTH,
  PLAN_BILLING_INTERVALS,
  STRIPE_ID_PATTERN,
  type PlanBillingInterval,
} from '../../../../common/config/dto.config';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  AI_MODEL_TIERS,
  DEFAULT_SEARCH,
  type AiModelTier,
  MAX_ANALYTICS_RANGE_DAYS,
  MAX_ATTACHMENT_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_TENANT,
  ORGANIZATION_SORTABLE_FIELDS,
  PLAN_SORTABLE_FIELDS,
  OrgStatus,
  PERMISSION_CODES,
  PermissionCode,
  USER_SORTABLE_FIELDS,
  lowerIfString,
  trimIfString,
  type OrganizationSortableField,
  type PlanSortableField,
  type UserSortableField,
} from '@synapsedesk/common';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';

export class ListPlatformOrganizationsQueryDto extends OmitType(
  SearchPaginationDto,
  ['sortBy'] as const,
) {
  @IsOptional()
  @IsString()
  @IsIn(ORGANIZATION_SORTABLE_FIELDS)
  // `@ApiPropertyOptional()` is required here: the Swagger plugin derives
  // `required` from TYPESCRIPT optionality, so a defaulted non-optional field
  // is documented as mandatory and a generated client refuses to omit it.
  @ApiPropertyOptional()
  readonly sortBy: OrganizationSortableField = DEFAULT_SEARCH.SORT_BY;

  @IsOptional()
  @IsIn(Object.values(OrgStatus))
  readonly status?: OrgStatus;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly includeDeleted: boolean = false;
}

export class ListPlatformUsersQueryDto extends OmitType(SearchPaginationDto, [
  'sortBy',
] as const) {
  @IsOptional()
  @IsString()
  @IsIn(USER_SORTABLE_FIELDS)
  @ApiPropertyOptional()
  readonly sortBy: UserSortableField = DEFAULT_SEARCH.SORT_BY;

  @IsOptional()
  @IsUUID()
  readonly organizationId?: string;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly includeDeleted: boolean = false;
}

/**
 * Creates a tenant AND its first Org Admin. Both or neither.
 *
 * No admin password field, deliberately: an admin-chosen password has to reach
 * the human out of band, and the reset flow is what proves they hold the
 * address anyway.
 */
export class CreatePlatformOrganizationDto {
  @IsString()
  @MinLength(MIN_ORGANIZATION_NAME_LENGTH)
  @MaxLength(MAX_ORGANIZATION_NAME_LENGTH)
  @Transform(trimIfString)
  @NoEmoji()
  readonly name!: string;

  @IsString()
  @MinLength(MIN_ORGANIZATION_SLUG_LENGTH)
  @MaxLength(MAX_ORGANIZATION_SLUG_LENGTH)
  @Matches(ORGANIZATION_SLUG_PATTERN)
  // **Lowercased BEFORE the pattern, and that is a compatibility fix.**
  // class-transformer runs ahead of class-validator regardless of decorator
  // order, so `ACME-CORP` becomes `acme-corp` and passes. Without it the
  // pattern turned a request that used to succeed into a 400: the service has
  // done `.trim().toLowerCase()` on this field all along
  // (`platform.service.ts`), so uppercase was accepted and canonicalized, not
  // rejected. Moving the refusal earlier is right for `acme corp` and
  // `acme/corp`, which nothing ever fixed — it is not right for case.
  @Transform(lowerIfString)
  @Transform(trimIfString)
  readonly slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_ORGANIZATION_DOMAIN_LENGTH)
  @Transform(trimIfString)
  readonly domain?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ALLOWED_EMAIL_DOMAINS)
  @IsString({ each: true })
  @ApiPropertyOptional()
  readonly allowedEmailDomains: string[] = [];

  @IsEmail()
  readonly adminEmail!: string;

  @IsString()
  @MinLength(MIN_FULL_NAME_LENGTH)
  @MaxLength(MAX_FULL_NAME_LENGTH)
  @Transform(trimIfString)
  readonly adminFullName!: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_AGENT_SEATS)
  // The `?` is load-bearing: this maps to an `optional` proto field, where
  // ABSENT and zero are different messages. The proto says it outright --
  // "absent takes the schema default rather than zero" -- so a default here
  // would create a tenant with no storage, or reset a quota on every PATCH.
  readonly maxAgentSeats?: number;

  @IsOptional()
  @IsInt()
  @Min(MIN_STORAGE_BYTES)
  // The `?` is load-bearing: this maps to an `optional` proto field, where
  // ABSENT and zero are different messages. The proto says it outright --
  // "absent takes the schema default rather than zero" -- so a default here
  // would create a tenant with no storage, or reset a quota on every PATCH.
  readonly maxStorageBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(MIN_AI_TOKEN_BUDGET)
  // The `?` is load-bearing: this maps to an `optional` proto field, where
  // ABSENT and zero are different messages. The proto says it outright --
  // "absent takes the schema default rather than zero" -- so a default here
  // would create a tenant with no storage, or reset a quota on every PATCH.
  readonly monthlyAiTokenBudget?: number;
}

/** Everything the tenant-facing PATCH allows, PLUS quotas. */
export class UpdatePlatformOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(MIN_ORGANIZATION_NAME_LENGTH)
  @MaxLength(MAX_ORGANIZATION_NAME_LENGTH)
  @Transform(trimIfString)
  @NoEmoji()
  readonly name?: string;

  @IsOptional()
  @IsString()
  @MinLength(MIN_ORGANIZATION_SLUG_LENGTH)
  @MaxLength(MAX_ORGANIZATION_SLUG_LENGTH)
  @Matches(ORGANIZATION_SLUG_PATTERN)
  // **Lowercased BEFORE the pattern, and that is a compatibility fix.**
  // class-transformer runs ahead of class-validator regardless of decorator
  // order, so `ACME-CORP` becomes `acme-corp` and passes. Without it the
  // pattern turned a request that used to succeed into a 400: the service has
  // done `.trim().toLowerCase()` on this field all along
  // (`platform.service.ts`), so uppercase was accepted and canonicalized, not
  // rejected. Moving the refusal earlier is right for `acme corp` and
  // `acme/corp`, which nothing ever fixed — it is not right for case.
  @Transform(lowerIfString)
  @Transform(trimIfString)
  readonly slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_ORGANIZATION_DOMAIN_LENGTH)
  @Transform(trimIfString)
  readonly domain?: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_AGENT_SEATS)
  // The `?` is load-bearing: this maps to an `optional` proto field, where
  // ABSENT and zero are different messages. The proto says it outright --
  // "absent takes the schema default rather than zero" -- so a default here
  // would create a tenant with no storage, or reset a quota on every PATCH.
  readonly maxAgentSeats?: number;

  @IsOptional()
  @IsInt()
  @Min(MIN_STORAGE_BYTES)
  // The `?` is load-bearing: this maps to an `optional` proto field, where
  // ABSENT and zero are different messages. The proto says it outright --
  // "absent takes the schema default rather than zero" -- so a default here
  // would create a tenant with no storage, or reset a quota on every PATCH.
  readonly maxStorageBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(MIN_AI_TOKEN_BUDGET)
  // The `?` is load-bearing: this maps to an `optional` proto field, where
  // ABSENT and zero are different messages. The proto says it outright --
  // "absent takes the schema default rather than zero" -- so a default here
  // would create a tenant with no storage, or reset a quota on every PATCH.
  readonly monthlyAiTokenBudget?: number;
}

export class SetOrganizationStatusDto {
  @IsIn(Object.values(OrgStatus))
  readonly status!: OrgStatus;

  /** Required — the audit row is read months later by someone who was not there. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ADMIN_REASON_LENGTH)
  readonly reason!: string;
}

/**
 * A reason, required.
 *
 * This endpoint used to be routine tenant administration. Since billing
 * shipped it is BREAK-GLASS: `billing_cycle_start` follows Stripe's invoice
 * period, and its epoch is inside the Redis quota key, so rolling it by hand
 * desynchronizes the two AND hands the tenant a fresh AI budget. Neither
 * effect is visible in the response, which is why the audit row has to say who
 * did it and why.
 */
export class ResetBillingCycleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ADMIN_REASON_LENGTH)
  readonly reason!: string;
}

export class OffboardOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ADMIN_REASON_LENGTH)
  readonly reason!: string;
}

export class CreateGlobalRoleDto {
  @IsString()
  @MinLength(MIN_ORGANIZATION_NAME_LENGTH)
  @MaxLength(MAX_ROLE_NAME_LENGTH)
  @Transform(trimIfString)
  @NoEmoji()
  readonly name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_ROLE_DESCRIPTION_LENGTH)
  @ApiPropertyOptional({ description: MARKDOWN_FIELD_CONTRACT })
  readonly description?: string;

  @IsArray()
  @ArrayMaxSize(PERMISSION_CODES.length)
  @IsIn(PERMISSION_CODES, { each: true })
  readonly permissionCodes!: PermissionCode[];
}

export class ListPlansQueryDto extends OmitType(SearchPaginationDto, [
  'sortBy',
] as const) {
  @IsOptional()
  @IsString()
  @IsIn(PLAN_SORTABLE_FIELDS)
  @ApiPropertyOptional({ enum: PLAN_SORTABLE_FIELDS })
  readonly sortBy: PlanSortableField = DEFAULT_SEARCH.SORT_BY;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  // A real default rather than `?`: `bool include_inactive = 2` has implicit
  // presence, so absent and `false` are the same message on the wire and the
  // `?` buys the layers below a branch that can never matter. The sibling
  // query DTOs in this file were already written this way.
  readonly includeInactive: boolean = false;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly includeDeleted: boolean = false;
}

export class CreatePlanPriceDto {
  // Length and CHARACTER CLASS, never a `^price_` prefix. Stripe's id format is
  // a convention rather than a documented contract, and a locally well-formed
  // id that does not exist fails identically to a malformed one — so prefix
  // matching adds a rule this repo would have to maintain against a third
  // party's naming and buys nothing. What is worth refusing at the edge is an
  // absurd string being carried into an API call.
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_STRIPE_ID_LENGTH)
  @Matches(STRIPE_ID_PATTERN, {
    message: 'stripePriceId must be alphanumeric with _ or - separators',
  })
  readonly stripePriceId!: string;

  @IsString()
  @IsIn(PLAN_BILLING_INTERVALS)
  readonly interval!: PlanBillingInterval;
}

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  @NoEmoji()
  @MinLength(MIN_PLAN_NAME_LENGTH)
  @MaxLength(MAX_PLAN_NAME_LENGTH)
  @Transform(trimIfString)
  readonly name!: string;

  // Optional because a plan with NO Stripe product is legal and useful: the
  // negotiated enterprise agreement, assigned directly and invisible to
  // self-service.
  @IsOptional()
  @IsString()
  @MaxLength(MAX_STRIPE_ID_LENGTH)
  // The same rule `stripePriceId` above already carries. It was missing here,
  // so the two Stripe ids in this file were validated to different depths — and
  // this one also accepted `''`, which is neither a product id nor a null.
  // Clearing is `clearStripeProductId`, never an empty string.
  @Matches(STRIPE_ID_PATTERN, {
    message: 'stripeProductId must be alphanumeric with _ or - separators',
  })
  readonly stripeProductId?: string;

  // Every grant REQUIRED, with no `@IsOptional()` anywhere below. A plan states
  // every limit it grants, with no blanks — a plan that does not differentiate
  // on a dimension states the platform ceiling explicitly, which is a decision
  // recorded rather than inferred.
  @IsInt()
  @Min(MIN_AGENT_SEATS)
  readonly maxAgentSeats!: number;

  @IsInt()
  @Min(MIN_STORAGE_BYTES)
  readonly maxStorageBytes!: number;

  @IsInt()
  @Min(MIN_AI_TOKEN_BUDGET)
  readonly monthlyAiTokenBudget!: number;

  @IsString()
  @IsIn(AI_MODEL_TIERS)
  readonly aiModelTier!: AiModelTier;

  // Bounded by the PLATFORM ceiling, refused rather than clamped. A plan can
  // only narrow: `MAX_DOCUMENT_BYTES` protects the parser and is not sellable,
  // so a row trying to sell past it is a mistake worth an error rather than a
  // silently smaller number nobody notices.
  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENT_BYTES)
  readonly maxDocumentBytes!: number;

  @IsInt()
  @Min(1)
  @Max(MAX_ATTACHMENT_BYTES)
  readonly maxAttachmentBytes!: number;

  // A COUNT, bounded by the platform's own cap on the corpus. Refused rather
  // than clamped, for the reason the byte ceilings are: a plan that tries to
  // sell past the platform is a mistake worth an error.
  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENTS_PER_TENANT)
  readonly maxDocumentUploads!: number;

  // The one grant whose narrowing takes something away. Bounded by
  // `MAX_ANALYTICS_RANGE_DAYS`, which is what the rollup tables can answer.
  @IsInt()
  @Min(1)
  @Max(MAX_ANALYTICS_RANGE_DAYS)
  readonly maxAnalyticsRangeDays!: number;

  // Defaults to ACTIVE, and the default belongs HERE rather than in the mapper:
  // `bool is_active = 9` has implicit presence, so the DTO is the last layer
  // that can tell "unstated" from `false`. A plan created without the flag is
  // one somebody intends to sell; deactivating is the deliberate act.
  //
  // No `@ToBoolean()`: this is a JSON body, where `true` arrives as a boolean.
  // The transform exists for QUERY STRINGS, where everything is text.
  @IsOptional()
  @IsBoolean()
  readonly isActive: boolean = true;

  // `[]`, not `?`. A `repeated` field cannot express absent-versus-empty on the
  // wire at all, so the `?` buys nothing and costs every layer below a branch
  // on `undefined` — a plan created with no prices is the assigned-only plan,
  // which is a legitimate row rather than a missing one.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PLAN_PRICES)
  @ValidateNested({ each: true })
  @Type(() => CreatePlanPriceDto)
  @ApiPropertyOptional({ type: [CreatePlanPriceDto] })
  readonly prices: CreatePlanPriceDto[] = [];
}

/**
 * A PATCH, where **every `?` is load-bearing and none may become a default.**
 *
 * Every field here maps to an `optional` proto field, which distinguishes
 * absent from zero. A default on any of them rewrites that column on every
 * unrelated edit — a PATCH touching only `name` would also reset the seat
 * count, and the next apply would propagate it to every subscriber. The create
 * message uses plain scalars and answers the same question the other way.
 */
export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @NoEmoji()
  @MinLength(MIN_PLAN_NAME_LENGTH)
  @MaxLength(MAX_PLAN_NAME_LENGTH)
  @Transform(trimIfString)
  readonly name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_STRIPE_ID_LENGTH)
  // The same rule `stripePriceId` above already carries. It was missing here,
  // so the two Stripe ids in this file were validated to different depths — and
  // this one also accepted `''`, which is neither a product id nor a null.
  // Clearing is `clearStripeProductId`, never an empty string.
  @Matches(STRIPE_ID_PATTERN, {
    message: 'stripeProductId must be alphanumeric with _ or - separators',
  })
  readonly stripeProductId?: string;

  // The explicit clear, because absent means "leave it": without this there is
  // no way to turn a sold plan back into an assigned one. Its existence is also
  // the tell for the rule above — a separate flag is only needed because absent
  // and cleared are different messages on this one.
  //
  // No `@ToBoolean()` and no default, for the same two reasons as the rest of
  // this class: it is a JSON body, and a default here would clear the product
  // id on every PATCH that did not mention it.
  @IsOptional()
  @IsBoolean()
  readonly clearStripeProductId?: boolean;

  @IsOptional()
  @IsInt()
  @Min(MIN_AGENT_SEATS)
  readonly maxAgentSeats?: number;

  @IsOptional()
  @IsInt()
  @Min(MIN_STORAGE_BYTES)
  readonly maxStorageBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(MIN_AI_TOKEN_BUDGET)
  readonly monthlyAiTokenBudget?: number;

  @IsOptional()
  @IsString()
  @IsIn(AI_MODEL_TIERS)
  readonly aiModelTier?: AiModelTier;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENT_BYTES)
  readonly maxDocumentBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_ATTACHMENT_BYTES)
  readonly maxAttachmentBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENTS_PER_TENANT)
  readonly maxDocumentUploads?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_ANALYTICS_RANGE_DAYS)
  readonly maxAnalyticsRangeDays?: number;

  @IsOptional()
  @IsBoolean()
  readonly isActive?: boolean;
}

export class ApplyPlanQueryDto {
  // Defaults to FALSE, so an apply is what an unqualified POST does and a dry
  // run is asked for. The opposite default would make the destructive call the
  // one you get by forgetting a parameter.
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly dryRun: boolean = false;
}

// Live, though nothing below mentions it: the platform controller and client
// both import `RoleResponseDto` from HERE rather than from `roles/`. Deleting
// this line fails the build in both.
export { RoleResponseDto } from '../../../roles/dto/rest/role-response.dto';
