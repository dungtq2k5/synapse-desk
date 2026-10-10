/**
 * @file A user as the REST API returns it.
 *
 * **REST only — it shares nothing with the GraphQL surface.** The schema's
 * `type User` is `UserResponseGqlDto`, declared separately in `./graphql/`. The
 * two describe the same domain object and are deliberately not the same class:
 * a DTO is a transport contract, and the two transports version independently.
 * `user-response.contract.spec.ts` asserts the field sets agree, so the
 * duplication cannot drift silently — which is the guarantee inheritance was
 * supposed to give and never did.
 *
 * This is also the source `CreateUserDto` and `UpdateUserDto` pick from, so the
 * validators here are the single definition of what a user field must look like
 * on the way IN.
 */

import {
  Gender,
  PERMISSION_CODES,
  type PermissionCode,
} from '@synapsedesk/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsIn,
  IsISO8601,
  IsPhoneNumber,
  IsString,
  IsUrl,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { IsNullable } from '../../../../common/decorators/is-nullable.decorator';

// The validators below never RUN -- `ValidationPipe` validates requests, and
// nothing sends this class. They are here for one reason: `classValidatorShim`
// reads them into the published OpenAPI schema, so removing one widens the
// documented response contract (a format or a bound disappears) while changing
// no behaviour a test could observe. `update-user.dto.ts` no longer derives
// from this class, so that is now their ONLY job.
/** A user as every REST route returns them. */
export class UserResponseDto {
  @IsUUID()
  readonly id!: string;

  /**
   * null for platform Super Admins, who belong to no tenant (RDM). Typed
   * non-nullable, this field made the seeded super admin impossible to return
   * from the API at all.
   */
  @IsNullable()
  @IsUUID()
  readonly organizationId!: string | null;

  @IsString()
  readonly fullName!: string;

  @IsNullable()
  @IsUrl()
  readonly avatarUrl!: string | null;

  @IsEmail()
  readonly email!: string;

  @Type(() => Boolean)
  @IsBoolean()
  readonly isEmailVerified!: boolean;

  @IsNullable()
  @IsPhoneNumber()
  readonly phoneNumber!: string | null;

  @Type(() => Boolean)
  @IsBoolean()
  readonly isPhoneVerified!: boolean;

  /**
   * Date of birth as ISO `YYYY-MM-DD` — a calendar date, with no time and no
   * zone. `null` when the user has not given one.
   */
  @IsNullable()
  @IsISO8601({ strict: true })
  readonly dob!: string | null;

  @IsEnum(Gender)
  readonly gender!: Gender;

  @Type(() => Date)
  @IsNullable()
  @IsDate()
  readonly lastLoginAt!: Date | null;

  @Type(() => Boolean)
  @IsBoolean()
  readonly isLocked!: boolean;

  /**
   * When a temporary lock lapses. `null` means the lock is INDEFINITE.
   *
   * Render on `isLocked`; read this to show *when* the lock ends.
   */
  @Type(() => Date)
  @IsNullable()
  @IsDate()
  readonly lockedUntil!: Date | null;

  @Type(() => Boolean)
  @IsBoolean()
  readonly isTwoFactorEnabled!: boolean;

  @Type(() => Date)
  @IsDate()
  readonly createdAt!: Date;

  @Type(() => Date)
  @IsDate()
  readonly updatedAt!: Date;
}

// The validators below are published as OpenAPI constraints by
// `classValidatorShim`; removing one widens the documented contract for
// `GET /users/me` without changing any behaviour a test could observe.
/** The authenticated caller, with their permissions and departments. */
export class CurrentUserResponseDto {
  @Type(() => UserResponseDto)
  @ValidateNested()
  readonly user!: UserResponseDto;

  /** Every permission code the caller holds, granted through their roles. */
  // `@IsIn`, not `@IsEnum`: `IsEnum` expects an enum object and matches a
  // readonly array only by accident. On a response DTO these are Swagger
  // metadata -- the narrowing to `PermissionCode[]` happens in the client.
  @IsArray()
  @IsIn(PERMISSION_CODES, { each: true })
  readonly permissionCodes!: PermissionCode[];

  @IsArray()
  @IsUUID('all', { each: true })
  readonly departmentIds!: string[];
}
