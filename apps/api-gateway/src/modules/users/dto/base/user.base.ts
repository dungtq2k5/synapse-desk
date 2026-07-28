import { Gender, IsNullable } from '@synapsedesk/common/main';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsPhoneNumber,
  IsString,
  IsUrl,
  IsUUID,
} from 'class-validator';

export class UserBase {
  @IsUUID()
  readonly id!: string;

  @IsUUID()
  readonly organizationId!: string;

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

  @Type(() => Date)
  @IsNullable()
  @IsDate()
  readonly dob!: Date | null;

  @IsEnum(Gender)
  readonly gender!: Gender;

  @Type(() => Date)
  @IsNullable()
  @IsDate()
  readonly lastLoginAt!: Date | null;

  @Type(() => Boolean)
  @IsBoolean()
  readonly isLocked!: boolean;

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
