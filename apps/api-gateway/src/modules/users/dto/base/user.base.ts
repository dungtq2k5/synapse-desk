import { Gender } from '@synapsedesk/common/main';
import { IsNullable } from '../../../../common/decorators/is-nullable.decorator';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsPhoneNumber,
  IsString,
  IsUrl,
  IsUUID,
} from 'class-validator';

export class UserBase {
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
