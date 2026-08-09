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
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OmitType, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEFAULT_SEARCH,
  ORGANIZATION_SORTABLE_FIELDS,
  OrgStatus,
  PERMISSION_CODES,
  PermissionCode,
  trimIfString,
  USER_SORTABLE_FIELDS,
  type OrganizationSortableField,
  type UserSortableField,
} from '@synapsedesk/common';
import { SearchPaginationBase } from '../../../../common/dto/base/search-pagination-base.dto';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import { UserResponseDto } from '../../../users/dto/rest/user-response.dto';
import { OrganizationResponseDto } from '../../../organizations/dto/rest/organization.dto';
import { RoleResponseDto } from '../../../roles/dto/rest/role.dto';

export class ListPlatformOrganizationsQueryDto extends OmitType(
  SearchPaginationBase,
  ['sortBy'] as const,
) {
  @IsOptional()
  @IsString()
  @IsIn(ORGANIZATION_SORTABLE_FIELDS)
  /**
   * Optional in the API and, without this, REQUIRED in the docs — 24-doc §1.
   *
   * The plugin derives `required` from TYPESCRIPT optionality, not from
   * `@IsOptional()`. A field declared `page: number = 1` is non-optional to the
   * compiler even though the validator lets a caller omit it, so the generated
   * spec demanded it — and a generated client would refuse to send a request
   * without one.
   */
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

export class ListPlatformUsersQueryDto extends OmitType(SearchPaginationBase, [
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
  @MinLength(2)
  @MaxLength(255)
  @Transform(trimIfString)
  readonly name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimIfString)
  readonly slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trimIfString)
  readonly domain?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  readonly allowedEmailDomains?: string[];

  @IsEmail()
  readonly adminEmail!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  @Transform(trimIfString)
  readonly adminFullName!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly maxAgentSeats?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  readonly maxStorageBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  readonly monthlyAiTokenBudget?: number;
}

/** Everything the tenant-facing PATCH allows, PLUS quotas. */
export class UpdatePlatformOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Transform(trimIfString)
  readonly name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimIfString)
  readonly slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trimIfString)
  readonly domain?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly maxAgentSeats?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  readonly maxStorageBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  readonly monthlyAiTokenBudget?: number;
}

export class SetOrganizationStatusDto {
  @IsIn(Object.values(OrgStatus))
  readonly status!: OrgStatus;

  /** Required — the audit row is read months later by someone who was not there. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  readonly reason!: string;
}

/**
 * A reason, required — 14-doc §5.
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
  @MaxLength(500)
  readonly reason!: string;
}

export class OffboardOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  readonly reason!: string;
}

export class CreateGlobalRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trimIfString)
  readonly name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly description?: string;

  @IsArray()
  @ArrayMaxSize(PERMISSION_CODES.length)
  @IsIn(PERMISSION_CODES, { each: true })
  readonly permissionCodes!: PermissionCode[];
}

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

// **`export`, not `export type`** — 24-doc §2. Re-exported as a VALUE because
// `@ApiWrappedResponse(RoleResponseDto)` needs its runtime identity to build a
// `$ref`; a type-only re-export erases the class and the reference cannot be
// built at all.
export { RoleResponseDto };
