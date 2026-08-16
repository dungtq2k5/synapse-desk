/**
 * A user as the REST API returns it.
 *
 * **REST only — it shares nothing with the GraphQL surface.** The schema's
 * `type User` is `UserResponseGqlDto`, declared separately in `../graphql/`. The
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

// ASK This `docblock` seems to be invalid
/**
 * **The validators here are not decoration, and removing them breaks two
 * things.** A FIXME used to sit on this line asking for exactly that, on the
 * reasonable-sounding ground that a response is never validated.
 *
 *  1. **`UpdateUserDto` is built from this class.** It is
 *     `PickType(UserResponseDto, ['fullName', 'phoneNumber', 'gender', 'dob'])`,
 *     and `PickType` copies the validation metadata along with the properties.
 *     Strip the decorators here and those fields keep compiling, keep serving,
 *     and stop being validated — on a REQUEST path, with no compile error and
 *     no failing test to notice it.
 *  2. **`classValidatorShim: true`** in `nest-cli.json` turns these into the
 *     published OpenAPI constraints. `openapi.e2e-spec.ts` proves the shim is
 *     engaged; without them the response schema loses its formats and bounds
 *     and every generated client gets weaker types.
 *
 * The doc block above already said the first half — "the validators here are
 * the single definition of what a user field must look like on the way IN".
 */
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

  // ASK This `docblock` seems to be invalid
  /**
   * ISO 'YYYY-MM-DD', not a Date. The column is `@db.Date` — a calendar date
   * with no time and no zone — so carrying it as an absolute instant would let
   * a birthday shift a day depending on the reader's offset.
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

  // ASK This `docblock` seems to be invalid
  /**
   * When a temporary lock lapses; `null` means INDEFINITE — 21-doc §2.
   *
   * `isLocked` stays the field a client renders on. This is here so an admin
   * screen can say "locked until Friday" instead of just "locked", and so an
   * expiry is visible before it fires rather than only after.
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

// ASK This `docblock` seems to be invalid
/**
 * Nothing derives from this one, so only the second reason above applies — but
 * it applies on its own. `classValidatorShim` reads these decorators into the
 * OpenAPI schema, so removing them would quietly widen the documented contract
 * for `GET /users/me` while changing no behaviour anyone could observe in a
 * test.
 */
export class CurrentUserResponseDto {
  @Type(() => UserResponseDto)
  @ValidateNested()
  readonly user!: UserResponseDto;

  // ASK This `docblock` seems to be invalid
  /**
   * `@IsIn`, not `@IsEnum`. `IsEnum` expects an enum object and works on a
   * readonly array only by accident, via `Object.values`. `IsIn` is the
   * decorator that actually means "one of these values".
   *
   * Note these run on the way IN, not out — `ValidationPipe` validates request
   * payloads, so on a response DTO they are documentation and Swagger metadata.
   * The real narrowing of `string[]` (what the proto declares) to
   * `PermissionCode[]` happens in the gRPC client.
   */
  @IsArray()
  @IsIn(PERMISSION_CODES, { each: true })
  readonly permissionCodes!: PermissionCode[];

  @IsArray()
  @IsUUID('all', { each: true })
  readonly departmentIds!: string[];
}
