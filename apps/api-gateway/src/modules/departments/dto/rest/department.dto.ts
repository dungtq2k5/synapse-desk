import { Transform, Type } from 'class-transformer';
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
import { OmitType, ApiPropertyOptional } from '@nestjs/swagger';
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
  readonly name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
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
  readonly name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
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
  @IsBoolean()
  @Type(() => Boolean)
  @ApiPropertyOptional()
  readonly isPrimary: boolean = false;
}

export class DepartmentResponseDto {
  readonly id!: string;
  readonly name!: string;
  readonly description!: string | null;
  readonly memberCount!: number;
  /** Non-null only on a soft-deleted row. */
  readonly deletedAt!: Date | null;
  readonly deletedByName!: string | null;
  readonly createdAt!: Date;
  readonly updatedAt!: Date;
}

export class DepartmentMemberResponseDto {
  readonly user!: unknown;
  readonly isPrimary!: boolean;
  readonly assignedByName!: string | null;
  readonly assignedAt!: Date;
}

export class AddDepartmentMembersResponseDto {
  /** New memberships. */
  readonly addedCount!: number;
  /** Existing memberships whose `isPrimary`/assigner were refreshed instead. */
  readonly updatedCount!: number;
}
