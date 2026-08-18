import { Type } from 'class-transformer';
import { OmitType, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  DEFAULT_SEARCH,
  USER_SORTABLE_FIELDS,
  type UserSortableField,
} from '@synapsedesk/common';
import {
  MAX_FULL_NAME_LENGTH,
  MAX_LOCK_REASON_LENGTH,
  MIN_FULL_NAME_LENGTH,
} from '../../../../common/config/dto.config';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import { IsFutureDate } from '../../../../common/decorators/is-future-date.decorator';

export class ListUsersQueryDto extends OmitType(SearchPaginationDto, [
  'sortBy',
] as const) {
  @IsOptional()
  @IsString()
  @IsIn(USER_SORTABLE_FIELDS)
  // `@ApiPropertyOptional()` is required here: the Swagger plugin derives
  // `required` from TYPESCRIPT optionality, so a defaulted non-optional field
  // is documented as mandatory and a generated client refuses to omit it.
  @ApiPropertyOptional()
  readonly sortBy: UserSortableField = DEFAULT_SEARCH.SORT_BY;

  @IsOptional()
  @IsUUID()
  readonly departmentId?: string;

  @IsOptional()
  @IsUUID()
  readonly roleId?: string;

  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  readonly isLocked?: boolean;

  /** Requires `user.delete`, checked in the controller. */
  @IsOptional()
  @IsBoolean()
  @ToBoolean()
  @ApiPropertyOptional()
  readonly includeDeleted: boolean = false;
}

/**
 * Direct creation, for seeding and service accounts.
 *
 * There is no password field, and that is the point: an admin-chosen password
 * has to reach the human out of band, and `isEmailVerified` would start false
 * and unproven either way. The account is created without one and the user sets
 * it through the reset flow. The normal path is `POST /users/invitations`.
 */
export class CreateUserDto {
  @IsEmail()
  readonly email!: string;

  @IsString()
  @MinLength(MIN_FULL_NAME_LENGTH)
  @MaxLength(MAX_FULL_NAME_LENGTH)
  readonly fullName!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  @ApiPropertyOptional()
  readonly roleIds: string[] = [];

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  @ApiPropertyOptional()
  readonly departmentIds: string[] = [];

  @IsOptional()
  @IsUUID()
  readonly primaryDepartmentId?: string;
}

export class LockUserDto {
  /**
   * Why the account is being locked. Required — it lands in the audit metadata
   * and in the email to the user.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_LOCK_REASON_LENGTH)
  readonly reason!: string;

  /**
   * When the lock should lapse.
   *
   * **Absent means INDEFINITE**, which is the existing product and the default
   * an admin gets by not thinking about it.
   *
   * **A PAST date is rejected**, not accepted. The database would take
   * it happily and the account would lock and unlock in the same instant —
   * legal, and incomprehensible to the admin who set it and the user who got
   * the email. Validated here and re-checked in auth-service, because the
   * gateway is not the only possible caller.
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  @IsFutureDate()
  readonly lockedUntil?: string;
}

export class SetUserRolesDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  // Required, and NOT defaulted to `[]`: this route SETS the role list, so an
  // omitted body would read as "strip every role" rather than "change nothing".
  readonly roleIds!: string[];
}

export class DepartmentAssignmentDto {
  @IsUUID()
  readonly departmentId!: string;

  @IsBoolean()
  readonly isPrimary!: boolean;
}

export class SetUserDepartmentsDto {
  /**
   * The departments to assign, and which of them is primary.
   *
   * Exactly one entry must be primary when the list is non-empty; the service
   * enforces it, because zero is as invalid as two.
   */
  @IsArray()
  // Required for the same reason as `SetUserRolesDto.roleIds`: this route SETS
  // the list, so a default would turn an omitted body into a mass unassignment.
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DepartmentAssignmentDto)
  readonly departments!: DepartmentAssignmentDto[];
}
