import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Gender, trimIfString } from '@synapsedesk/common';
import { IsNullable } from '../../../../common/decorators/is-nullable.decorator';
import {
  MAX_FULL_NAME_LENGTH,
  MIN_FULL_NAME_LENGTH,
} from '../../../../common/config/dto.config';

// Declared field by field rather than `PickType(UserResponseDto, …)`. A request
// class deriving from a RESPONSE class inherits that class's validators, which
// exist there to shape the published OpenAPI schema -- so the two ends of the
// route silently share one set of rules that only one of them is about. It also
// left `UserResponseDto` looking like a validated request. Conventions 12.1.
//
// `avatarUrl` is ABSENT on purpose, here and on `UpdateOwnProfileDto`: with
// `forbidNonWhitelisted`, sending it is a 400. The column is written only by
// `POST /users/me/avatar/confirm`, which proves the object was uploaded by this
// caller and deletes the one it replaces. Accepting a string here skips both.
/** The fields an administrator may change on another user. */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(MIN_FULL_NAME_LENGTH)
  @MaxLength(MAX_FULL_NAME_LENGTH)
  @Transform(trimIfString)
  readonly fullName?: string;

  @IsOptional()
  @IsNullable()
  @IsPhoneNumber()
  readonly phoneNumber?: string | null;

  @IsOptional()
  @IsEnum(Gender)
  readonly gender?: Gender;

  /** Date of birth as ISO `YYYY-MM-DD` — a calendar date, no time, no zone. */
  @IsOptional()
  @IsNullable()
  @IsISO8601({ strict: true })
  readonly dob?: string | null;
}

/**
 * Own profile (`PATCH /users/me`).
 *
 * Narrower than {@link UpdateUserDto} on purpose: `phoneNumber` is absent
 * because changing it goes through the OTP flow that already exists
 * (`otps.target` was designed for exactly this), and `email` /
 * `isEmailVerified` / `isLocked` / roles / departments are administrative.
 *
 * `forbidNonWhitelisted` turns an attempt at any of them into a 400
 * automatically — so keeping this class narrow IS the enforcement.
 */
export class UpdateOwnProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(MIN_FULL_NAME_LENGTH)
  @MaxLength(MAX_FULL_NAME_LENGTH)
  @Transform(trimIfString)
  readonly fullName?: string;

  @IsOptional()
  @IsEnum(Gender)
  readonly gender?: Gender;

  /** Date of birth as ISO `YYYY-MM-DD` — a calendar date, no time, no zone. */
  @IsOptional()
  @IsNullable()
  @IsISO8601({ strict: true })
  readonly dob?: string | null;
}
