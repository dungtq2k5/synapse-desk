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
  MIN_FULL_NAME_LENGTH,
} from '../../../../common/config/dto.config';
import { SearchPaginationBase } from '../../../../common/dto/base/search-pagination-base.dto';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import { IsFutureDate } from '../../../../common/decorators/is-future-date.decorator';
import { UserResponseDto } from './user-response.dto';

export class ListUsersQueryDto extends OmitType(SearchPaginationBase, [
  'sortBy',
] as const) {
  @IsOptional()
  @IsString()
  @IsIn(USER_SORTABLE_FIELDS)
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
  readonly roleIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  readonly departmentIds?: string[];

  @IsOptional()
  @IsUUID()
  readonly primaryDepartmentId?: string;
}

export class LockUserDto {
  /**
   * Required, not optional. It lands in the audit metadata and in the email to
   * the user, and "why is this account locked?" is asked months later by
   * someone who was not there.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  readonly reason!: string;

  /**
   * When the lock should lapse — 21-doc §2.
   *
   * **Absent means INDEFINITE**, which is the existing product and the default
   * an admin gets by not thinking about it.
   *
   * **A PAST date is rejected**, not accepted (§2.4). The database would take
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
   * Exactly one entry must be primary when the list is non-empty — validated in
   * the service, because zero is as invalid as two and the partial unique index
   * only catches the "two" case.
   */
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DepartmentAssignmentDto)
  readonly departments!: DepartmentAssignmentDto[];
}

export class UserSummaryResponseDto {
  readonly user!: UserResponseDto;
  readonly roleIds!: string[];
  readonly roleNames!: string[];
  readonly departmentIds!: string[];
  /** Non-null only on a deactivated account. */
  readonly deletedAt!: Date | null;
  readonly deletedByName!: string | null;
}

export class RevokedSessionCountDto {
  readonly revokedSessionCount!: number;
}

export class UntrustedDeviceCountDto {
  readonly untrustedDeviceCount!: number;
}

export class UserPermissionsResponseDto {
  readonly permissionCodes!: string[];
}
