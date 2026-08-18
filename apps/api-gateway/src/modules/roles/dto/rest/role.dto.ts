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
  MAX_ROLE_DESCRIPTION_LENGTH,
  MAX_ROLE_NAME_LENGTH,
  MIN_ROLE_NAME_LENGTH,
} from '../../../../common/config/dto.config';

// `OmitType` then re-declare `sortBy`, so the allowlist, the type and the
// default are ONE decision. Inheriting the base's plain `sortBy: string` would
// accept any column name and fail two hops away, inside auth-service.
/** Query parameters for `GET /roles`. */
export class ListRolesQueryDto extends OmitType(SearchPaginationDto, [
  'sortBy',
] as const) {
  @IsOptional()
  @IsString()
  @IsIn(ROLE_SORTABLE_FIELDS)
  // `@ApiPropertyOptional()` is required here: the Swagger plugin derives
  // `required` from TYPESCRIPT optionality, so a defaulted non-optional field
  // is documented as mandatory and a generated client refuses to omit it.
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

// `@IsIn(PERMISSION_CODES)` rather than a bare `@IsString()`.
//
// The service re-checks this, so the validation here is not what makes it safe
// — it is what makes the failure legible: a typo'd code is a 400 naming the
// field at the edge, rather than a gRPC INVALID_ARGUMENT surfacing from two
// hops away.
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
  @MaxLength(MAX_ROLE_DESCRIPTION_LENGTH)
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
  @MaxLength(MAX_ROLE_DESCRIPTION_LENGTH)
  readonly description?: string;
}

/** REPLACE semantics — the submitted set becomes the role's permissions. */
export class SetRolePermissionsDto extends PermissionCodesDto {}
