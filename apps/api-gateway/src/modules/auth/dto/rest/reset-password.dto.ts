import {
  IsNotEmpty,
  IsString,
  IsStrongPassword,
  MaxLength,
} from 'class-validator';
import { MAX_RESET_TOKEN_LENGTH } from '../../../../common/config/dto.config';

export class ResetPasswordDto {
  @IsNotEmpty()
  @IsString()
  // A CEILING, not the exact length. The token is 32 random bytes base64url'd
  // by auth-service, and `VarChar(64)` is the column holding its SHA-256 HASH,
  // not the token -- neither number belongs here. This only stops a megabyte of
  // string reaching a hash-and-lookup; auth-service compares the hash, which is
  // the real check.
  @MaxLength(MAX_RESET_TOKEN_LENGTH)
  readonly token!: string;

  @IsString()
  @IsStrongPassword()
  readonly newPassword!: string;
}

/**
 * Changing a password you KNOW, as opposed to resetting one you have forgotten.
 *
 * `currentPassword` is the whole security value of this endpoint: without it a
 * hijacked session could be turned into permanent account takeover. It is
 * verified server-side and never trusted from the client.
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  readonly currentPassword!: string;

  // Same strength rule as the reset flow. Applying a weaker one here would let
  // a user downgrade a password that the reset form would have rejected.
  @IsString()
  @IsStrongPassword()
  readonly newPassword!: string;
}
