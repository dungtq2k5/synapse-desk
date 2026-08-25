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
} from '../../../../common/config/dto.config';
import { Transform } from 'class-transformer';
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
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  DEFAULT_SEARCH,
  ORGANIZATION_SORTABLE_FIELDS,
  OrgStatus,
  PERMISSION_CODES,
  PermissionCode,
  USER_SORTABLE_FIELDS,
  lowerIfString,
  trimIfString,
  type OrganizationSortableField,
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

// Live, though nothing below mentions it: the platform controller and client
// both import `RoleResponseDto` from HERE rather than from `roles/`. Deleting
// this line fails the build in both.
export { RoleResponseDto } from '../../../roles/dto/rest/role-response.dto';
