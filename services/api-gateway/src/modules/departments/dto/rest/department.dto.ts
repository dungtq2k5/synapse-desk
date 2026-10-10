import { NoEmoji } from '../../../../common/decorators/no-emoji.decorator';
import { MARKDOWN_FIELD_CONTRACT } from '../../../../common/config/markdown-contract.config';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  DEFAULT_SEARCH,
  DEPARTMENT_MEMBER_SORTABLE_FIELDS,
  DEPARTMENT_SORTABLE_FIELDS,
  type DepartmentMemberSortableField,
  type DepartmentSortableField,
} from '@synapsedesk/common';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import {
  MAX_DEPARTMENT_DESCRIPTION_LENGTH,
  MAX_DEPARTMENT_MEMBERS_PER_BATCH,
  MAX_DEPARTMENT_NAME_LENGTH,
  MIN_DEPARTMENT_NAME_LENGTH,
} from '../../../../common/config/dto.config';
import { trimIfString } from '@synapsedesk/common';

export class ListDepartmentsQueryDto extends OmitType(SearchPaginationDto, [
  'sortBy',
] as const) {
  @IsOptional()
  @IsString()
  @IsIn(DEPARTMENT_SORTABLE_FIELDS)
  // `@ApiPropertyOptional()` is required here: the Swagger plugin derives
  // `required` from TYPESCRIPT optionality, so a defaulted non-optional field
  // is documented as mandatory and a generated client refuses to omit it.
  @ApiPropertyOptional()
  readonly sortBy: DepartmentSortableField = DEFAULT_SEARCH.SORT_BY;

  /**
   * Requires `department.delete` — the module's manage permission — which the
   * controller enforces. Without that gate any member could enumerate deleted
   * departments, which is organizational history they have no claim to.
   */
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly includeDeleted: boolean = false;
}

/**
 * Members are sorted by their own JOIN columns, so this overrides the base's
 * `createdAt` default — `user_departments` has no such column, and the
 * service's allowlist would reject it on a parameterless request.
 *
 * Deliberately NOT extending ListDepartmentsQueryDto: `includeDeleted` is
 * meaningless for a membership row (there is no soft delete on the junction),
 * and `forbidNonWhitelisted` should reject it rather than silently ignore it.
 */
export class ListDepartmentMembersQueryDto extends OmitType(
  SearchPaginationDto,
  ['sortBy'] as const,
) {
  @IsOptional()
  @IsString()
  @IsIn(DEPARTMENT_MEMBER_SORTABLE_FIELDS)
  @ApiPropertyOptional()
  readonly sortBy: DepartmentMemberSortableField = 'assignedAt';
}

export class CreateDepartmentDto {
  @IsString()
  @MinLength(MIN_DEPARTMENT_NAME_LENGTH)
  @MaxLength(MAX_DEPARTMENT_NAME_LENGTH)
  @Transform(trimIfString)
  @NoEmoji()
  readonly name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEPARTMENT_DESCRIPTION_LENGTH)
  @ApiPropertyOptional({ description: MARKDOWN_FIELD_CONTRACT })
  readonly description?: string;
}

/**
 * Every field optional: PATCH semantics. An omitted key means "leave
 * unchanged"; `description: ""` means "clear it". `forbidNonWhitelisted` in the
 * global ValidationPipe rejects anything not declared here, so this class is
 * also the allowlist of what may be changed.
 */
export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MinLength(MIN_DEPARTMENT_NAME_LENGTH)
  @MaxLength(MAX_DEPARTMENT_NAME_LENGTH)
  @Transform(trimIfString)
  @NoEmoji()
  readonly name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEPARTMENT_DESCRIPTION_LENGTH)
  @ApiPropertyOptional({ description: MARKDOWN_FIELD_CONTRACT })
  readonly description?: string;
}

export class AddDepartmentMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DEPARTMENT_MEMBERS_PER_BATCH)
  @IsUUID('all', { each: true })
  readonly userIds!: string[];

  /**
   * Makes THIS department primary for every user in the batch. A user has at
   * most one primary, so setting it here demotes whichever they had.
   */
  @IsOptional()
  // `@ToBoolean()`, NOT `@Type(() => Boolean)`: the latter resolves the STRING
  // `'false'` to `true`, so a caller opting out would silently opt in.
  @ToBoolean()
  @IsBoolean()
  @ApiPropertyOptional()
  readonly isPrimary: boolean = false;
}
