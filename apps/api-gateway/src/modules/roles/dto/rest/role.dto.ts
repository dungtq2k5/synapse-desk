import { Transform } from 'class-transformer';
import { OmitType, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  DEFAULT_SEARCH,
  PERMISSION_CODES,
  PermissionCode,
  ROLE_SORTABLE_FIELDS,
  type RoleSortableField,
  trimIfString,
} from '@synapsedesk/common';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import {
  MAX_ROLE_NAME_LENGTH,
  MIN_ROLE_NAME_LENGTH,
} from '../../../../common/config/dto.config';

/**
 * `OmitType` then re-declare `sortBy`, so the allowlist, the TYPE and the
 * default are one decision instead of three. Inheriting the base's plain
 * `sortBy: string` would accept any column name here and only fail two hops
 * away, in auth-service.
 */
export class ListRolesQueryDto extends OmitType(SearchPaginationDto, [
  'sortBy',
] as const) {
  @IsOptional()
  @IsString()
  @IsIn(ROLE_SORTABLE_FIELDS)
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
  readonly sortBy: RoleSortableField = DEFAULT_SEARCH.SORT_BY;

  /**
   * Adds the four global system roles to the result.
   *
   * Defaults to FALSE so a caller that wants the assignable set has to ask —
   * silently widening a list is the riskier default, and the role editor knows
   * which view it wants.
   */
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly includeSystem: boolean = false;
}

/**
 * `@IsIn(PERMISSION_CODES)` rather than a bare `@IsString()`.
 *
 * The service re-checks this, so the validation here is not what makes it safe
 * — it is what makes the failure legible: a typo'd code is a 400 naming the
 * field at the edge, rather than a gRPC INVALID_ARGUMENT surfacing from two
 * hops away.
 */
class PermissionCodesDto {
  @IsArray()
  @ArrayMaxSize(PERMISSION_CODES.length)
  @IsIn(PERMISSION_CODES, { each: true })
  readonly permissionCodes!: PermissionCode[];
}

export class CreateRoleDto extends PermissionCodesDto {
  @IsString()
  @MinLength(MIN_ROLE_NAME_LENGTH)
  @MaxLength(MAX_ROLE_NAME_LENGTH)
  @Transform(trimIfString)
  readonly name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly description?: string;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(MIN_ROLE_NAME_LENGTH)
  @MaxLength(MAX_ROLE_NAME_LENGTH)
  @Transform(trimIfString)
  readonly name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly description?: string;
}

/** REPLACE semantics — the submitted set becomes the role's permissions. */
export class SetRolePermissionsDto extends PermissionCodesDto {}

export class RoleResponseDto {
  readonly id!: string;
  readonly name!: string;
  readonly description!: string | null;
  /** Readable by every tenant, mutable by none. */
  readonly isSystemRole!: boolean;
  readonly userAssigned!: number;
  readonly permissionCodes!: string[];
  readonly createdAt!: Date;
  readonly updatedAt!: Date;
}

export class PermissionResponseDto {
  readonly id!: string;
  readonly code!: string;
  readonly name!: string;
  /** The `target` prefix of the code, for grouping in the role editor. */
  readonly group!: string;
}
